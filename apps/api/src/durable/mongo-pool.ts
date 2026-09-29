import { DurableObject } from "cloudflare:workers";
import { MongoClient, type Document } from "mongodb";
import { decryptSecret } from "../lib/crypto.js";
import { inferFields, isSafeCollectionName, orderCollections, toPlain } from "../lib/mongo.js";
import {
  DENTICON,
  PATIENT_PROJECTION,
  applyAllocations,
  groupVisits,
  procedureMatch,
  providerName,
  toAllocation,
  toLedgerLine,
  toPatientSummary,
  type ProcedureFilters,
  type ProcedureGroup,
  type ProcedureGroupBy,
  type ProcedureRow,
  type PatientDetail,
  type PatientSummary,
} from "../lib/denticon.js";

/** Close the pool after this long without a request. */
const IDLE_MS = 10 * 60 * 1000;
const POOL_SIZE = 5;

export interface PoolEnv {
  BETTER_AUTH_SECRET: string;
}

export interface DocsQuery {
  q?: string;
  page: number;
  pageSize: number;
}

export interface DocsResult {
  docs: Record<string, unknown>[];
  fields: string[];
  total: number;
}

/**
 * One instance per office (id = office id). Keeps a MongoClient with a small
 * connection pool alive between requests so Atlas handshakes (TLS + SRV +
 * auth) are paid once, not per HTTP request. Calls carry the encrypted
 * connection string; the object decrypts it with the Worker secret and
 * reconnects only when the string changes.
 */
export class MongoPool extends DurableObject<PoolEnv> {
  private client: MongoClient | null = null;
  private connectedTo: string | null = null; // the encrypted payload currently connected
  private lastUsed = 0;

  private async getClient(urlEncrypted: string): Promise<MongoClient> {
    if (this.client && this.connectedTo === urlEncrypted) {
      await this.touch();
      return this.client;
    }
    await this.closeClient();
    const url = await decryptSecret(this.env.BETTER_AUTH_SECRET, urlEncrypted);
    const client = new MongoClient(url, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      socketTimeoutMS: 20000,
      maxPoolSize: POOL_SIZE,
      minPoolSize: 0,
      maxIdleTimeMS: IDLE_MS,
      appName: "usermanagement-pool",
    } as ConstructorParameters<typeof MongoClient>[1]);
    await client.connect();
    this.client = client;
    this.connectedTo = urlEncrypted;
    await this.touch();
    return client;
  }

  private async touch() {
    this.lastUsed = Date.now();
    await this.ctx.storage.setAlarm(this.lastUsed + IDLE_MS);
  }

  private async closeClient() {
    const c = this.client;
    this.client = null;
    this.connectedTo = null;
    if (c) await c.close().catch(() => {});
  }

  /** Drop the client so a failed call does not poison the pool. */
  private async withClient<T>(urlEncrypted: string, fn: (client: MongoClient) => Promise<T>): Promise<T> {
    const client = await this.getClient(urlEncrypted);
    try {
      return await fn(client);
    } catch (err) {
      await this.closeClient();
      throw err;
    }
  }

  override async alarm() {
    if (Date.now() - this.lastUsed >= IDLE_MS) await this.closeClient();
    else await this.ctx.storage.setAlarm(this.lastUsed + IDLE_MS);
  }

  // ---- RPC surface (called from the Worker via env.MONGO_POOL.get(id)) ----

  /** Ping and list collections. Throws with the driver's message on failure. */
  async probe(urlEncrypted: string, database: string): Promise<string[]> {
    return this.withClient(urlEncrypted, async (client) => {
      const db = client.db(database);
      await db.command({ ping: 1 });
      const list = await db.listCollections({}, { nameOnly: true }).toArray();
      return orderCollections(list.map((c) => c.name).filter(isSafeCollectionName));
    });
  }

  async listCollections(urlEncrypted: string, database: string): Promise<{ name: string; count: number | null }[]> {
    return this.withClient(urlEncrypted, async (client) => {
      const db = client.db(database);
      const list = await db.listCollections({}, { nameOnly: true }).toArray();
      const names = orderCollections(list.map((x) => x.name).filter(isSafeCollectionName));
      return Promise.all(names.map(async (name) => ({ name, count: await db.collection(name).estimatedDocumentCount().catch(() => null) })));
    });
  }

  async findDocuments(urlEncrypted: string, database: string, collection: string, query: DocsQuery): Promise<DocsResult> {
    if (!isSafeCollectionName(collection)) throw new Error("Invalid collection name");
    return this.withClient(urlEncrypted, async (client) => {
      const coll = client.db(database).collection(collection);
      let filter: Document = {};
      if (query.q) {
        // Find string fields from a small sample, then regex-match any of them.
        const sample = await coll.find({}, { limit: 50 }).toArray();
        const stringFields = new Set<string>();
        for (const d of sample) for (const [k, v] of Object.entries(d)) if (typeof v === "string") stringFields.add(k);
        const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter = stringFields.size ? { $or: [...stringFields].map((f) => ({ [f]: { $regex: escaped, $options: "i" } })) } : { _id: null };
      }
      const skip = (query.page - 1) * query.pageSize;
      const [docs, total, sample] = await Promise.all([
        coll.find(filter).sort({ _id: -1 }).skip(skip).limit(query.pageSize).toArray(),
        coll.countDocuments(filter, { limit: 100_000 }),
        // Field discovery from a wider sample so optional fields still show up in the column picker.
        query.page === 1 ? coll.find({}, { limit: 200 }).sort({ _id: -1 }).toArray() : Promise.resolve([] as Document[]),
      ]);
      return { docs: docs.map((d) => toPlain(d) as Record<string, unknown>), fields: inferFields([...docs, ...sample]), total };
    });
  }

  // ---- Denticon patient pages ----

  /** Search patients by name, id, phone or email. Every word must match some field. */
  async listPatients(
    urlEncrypted: string,
    database: string,
    query: {
      q?: string;
      page: number;
      pageSize: number;
      activeOnly?: boolean;
      sort?: string;
      order?: "asc" | "desc";
      /** Inclusive YYYY-MM-DD bounds on a date field (either bound optional). */
      dateRange?: { field: "lastVisitDate" | "birthDate"; from?: string; to?: string };
    },
  ): Promise<{ patients: PatientSummary[]; total: number }> {
    return this.withClient(urlEncrypted, async (client) => {
      const coll = client.db(database).collection(DENTICON.patients);
      const words = (query.q ?? "").split(/\s+/).filter(Boolean).slice(0, 5);
      const and: Document[] = [];
      if (query.activeOnly) and.push({ active: { $ne: false } });
      for (const w of words) {
        const rx = { $regex: w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
        and.push({ $or: [{ firstName: rx }, { lastName: rx }, { nickname: rx }, { patientId: rx }, { cellPhone: rx }, { homePhone: rx }, { email: rx }, { chartNo: rx }] });
      }
      if (query.dateRange) {
        // birthDate is stored as "YYYY-MM-DD"; lastVisitDate as a BSON date. Match either representation.
        const { field, from, to } = query.dateRange;
        const asString: Document = {};
        const asDate: Document = {};
        if (from) {
          asString.$gte = from;
          asDate.$gte = new Date(`${from}T00:00:00.000Z`);
        }
        if (to) {
          asString.$lte = `${to}\uffff`;
          asDate.$lte = new Date(`${to}T23:59:59.999Z`);
        }
        and.push({ $or: [{ [field]: asString }, { [field]: asDate }] });
      }
      const filter: Document = and.length ? { $and: and } : {};
      const SORTABLE = new Set(["lastName", "firstName", "patientId", "birthDate", "lastVisitDate", "city"]);
      const sortField = query.sort && SORTABLE.has(query.sort) ? query.sort : "lastName";
      const dir = query.order === "desc" ? -1 : 1;
      const sort: Record<string, 1 | -1> = { [sortField]: dir };
      if (sortField !== "lastName") sort.lastName = 1;
      if (sortField !== "firstName") sort.firstName = 1;
      const [docs, total] = await Promise.all([
        coll
          .find(filter, { projection: PATIENT_PROJECTION })
          .sort(sort)
          .skip((query.page - 1) * query.pageSize)
          .limit(query.pageSize)
          .toArray(),
        coll.countDocuments(filter, { limit: 100_000 }),
      ]);
      return { patients: docs.map(toPatientSummary), total };
    });
  }

  /** One patient with their ledger grouped into visits by date of service. */
  async getPatient(urlEncrypted: string, database: string, patientId: string): Promise<PatientDetail | null> {
    return this.withClient(urlEncrypted, async (client) => {
      const db = client.db(database);
      const patient = await db.collection(DENTICON.patients).findOne({ patientId }, { projection: PATIENT_PROJECTION });
      if (!patient) return null;
      const [txns, providerDocs, allocationDocs] = await Promise.all([
        db.collection(DENTICON.transactions).find({ patientId }).sort({ transactionDate: -1, createdOn: -1 }).limit(5000).toArray(),
        db.collection(DENTICON.providers).find({}, { projection: { providerId: 1, providerShortId: 1, title: 1, firstName: 1, lastName: 1 } }).toArray(),
        db.collection(DENTICON.allocations).find({ patientId }).limit(10000).toArray().catch(() => [] as Document[]),
      ]);
      const providers = Object.fromEntries(providerDocs.map(providerName));
      const lines = txns.map((t) => toLedgerLine(t, providers));
      applyAllocations(lines, allocationDocs.map(toAllocation));
      const visits = groupVisits(lines);
      const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
      const treatments = lines.filter((l) => l.kind === "procedure");
      const paymentLines = lines.filter((l) => l.kind === "payment");
      const charges = sum(treatments.map((l) => l.amount));
      const payments = sum(paymentLines.map((l) => -l.amount));
      const adjustments = sum(lines.filter((l) => l.kind === "adjustment").map((l) => l.amount));
      const count = (status: string) => treatments.filter((l) => l.payment?.status === status).length;
      return {
        patient: toPlain(patient) as Record<string, unknown>,
        summary: toPatientSummary(patient),
        totals: {
          charges,
          payments,
          adjustments,
          balance: Math.round((charges + adjustments - payments) * 100) / 100,
          visits: visits.filter((v) => v.procedures.length > 0).length,
          procedures: treatments.length,
          paid: count("paid"),
          partial: count("partial"),
          unpaid: count("unpaid"),
          unallocatedPayments: sum(paymentLines.map((l) => l.applied?.unallocated ?? 0)),
        },
        treatments,
        visits,
        payments: lines.filter((l) => l.kind === "payment"),
        providers,
        transactionCount: lines.length,
      };
    });
  }

  // ---- Office-wide procedures ----

  /** Flat, paginated list of charge lines with patient names and paid status. */
  async listProcedures(
    urlEncrypted: string,
    database: string,
    filters: ProcedureFilters,
    page: number,
    pageSize: number,
  ): Promise<{ rows: ProcedureRow[]; total: number; providers: Record<string, string> }> {
    return this.withClient(urlEncrypted, async (client) => {
      const db = client.db(database);
      const match = procedureMatch(filters);
      const txns = db.collection(DENTICON.transactions);
      const [docs, total, providerDocs] = await Promise.all([
        txns.find(match).sort({ transactionDate: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
        txns.countDocuments(match, { limit: 200_000 }),
        db.collection(DENTICON.providers).find({}, { projection: { providerId: 1, providerShortId: 1, title: 1, firstName: 1, lastName: 1 } }).toArray(),
      ]);
      const providers = Object.fromEntries(providerDocs.map(providerName));
      const lines = docs.map((d) => toLedgerLine(d, providers));
      const ledgerIds = lines.map((l) => l.ledgerId).filter((x): x is string => !!x);
      const patientIds = [...new Set(docs.map((d) => String(d.patientId ?? "")).filter(Boolean))];
      const [allocDocs, patientDocs] = await Promise.all([
        ledgerIds.length ? db.collection(DENTICON.allocations).find({ procedureLedgerId: { $in: ledgerIds } }).toArray() : [],
        patientIds.length ? db.collection(DENTICON.patients).find({ patientId: { $in: patientIds } }, { projection: { patientId: 1, firstName: 1, lastName: 1 } }).toArray() : [],
      ]);
      applyAllocations(lines, allocDocs.map(toAllocation));
      const names = new Map(patientDocs.map((p) => [String(p.patientId), [p.firstName, p.lastName].filter(Boolean).join(" ")]));
      const rows: ProcedureRow[] = lines.map((l, i) => {
        const pid = String(docs[i]!.patientId ?? "");
        return { ...l, patientId: pid, patientName: names.get(pid) || pid };
      });
      return { rows, total, providers };
    });
  }

  /** Grouped summaries (by patient, service day, or both) with paid amounts for the page. */
  async groupProcedures(
    urlEncrypted: string,
    database: string,
    groupBy: Exclude<ProcedureGroupBy, "none">,
    filters: ProcedureFilters,
    page: number,
    pageSize: number,
  ): Promise<{ groups: ProcedureGroup[]; total: number; providers: Record<string, string> }> {
    return this.withClient(urlEncrypted, async (client) => {
      const db = client.db(database);
      const match = procedureMatch(filters);
      const day = { $dateToString: { format: "%Y-%m-%d", date: "$transactionDate" } };
      const id = groupBy === "date" ? { day } : groupBy === "patient" ? { patientId: "$patientId" } : { day, patientId: "$patientId" };
      const sort: Document = groupBy === "patient" ? { charges: -1, "_id.patientId": 1 } : { "_id.day": -1, charges: -1 };
      const [facet] = await db
        .collection(DENTICON.transactions)
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: id,
              procedures: { $sum: 1 },
              charges: { $sum: "$amount" },
              patients: { $addToSet: "$patientId" },
              firstDate: { $min: "$transactionDate" },
              lastDate: { $max: "$transactionDate" },
              ledgerIds: { $push: "$ledgerId" },
            },
          },
          { $sort: sort },
          { $facet: { total: [{ $count: "n" }], page: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }] } },
        ], { allowDiskUse: true })
        .toArray();
      const total = Number(facet?.total?.[0]?.n ?? 0);
      const pageDocs = (facet?.page ?? []) as Document[];

      // Paid / adjusted for exactly the procedures on this page of groups.
      const ledgerIds = [...new Set(pageDocs.flatMap((g) => (g.ledgerIds as string[]) ?? []).filter(Boolean))].slice(0, 20_000);
      const patientIds = [...new Set(pageDocs.map((g) => g._id.patientId as string | undefined).filter((x): x is string => !!x))];
      const [allocDocs, patientDocs, providerDocs] = await Promise.all([
        ledgerIds.length ? db.collection(DENTICON.allocations).find({ procedureLedgerId: { $in: ledgerIds } }, { projection: { procedureLedgerId: 1, amount: 1, ledgerType: 1 } }).toArray() : [],
        patientIds.length ? db.collection(DENTICON.patients).find({ patientId: { $in: patientIds } }, { projection: { patientId: 1, firstName: 1, lastName: 1 } }).toArray() : [],
        db.collection(DENTICON.providers).find({}, { projection: { providerId: 1, providerShortId: 1, title: 1, firstName: 1, lastName: 1 } }).toArray(),
      ]);
      const paidBy = new Map<string, { paid: number; adjusted: number }>();
      for (const a of allocDocs) {
        const k = String(a.procedureLedgerId);
        const e = paidBy.get(k) ?? { paid: 0, adjusted: 0 };
        if (a.ledgerType === "A") e.adjusted += Math.abs(Number(a.amount) || 0);
        else e.paid += Math.abs(Number(a.amount) || 0);
        paidBy.set(k, e);
      }
      const names = new Map(patientDocs.map((p) => [String(p.patientId), [p.firstName, p.lastName].filter(Boolean).join(" ")]));
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const groups: ProcedureGroup[] = pageDocs.map((g) => {
        let paid = 0;
        let adjusted = 0;
        for (const lid of (g.ledgerIds as string[]) ?? []) {
          const e = paidBy.get(String(lid));
          if (e) {
            paid += e.paid;
            adjusted += e.adjusted;
          }
        }
        const charges = r2(Number(g.charges) || 0);
        const pid = (g._id.patientId as string | undefined) ?? null;
        return {
          day: (g._id.day as string | undefined) ?? null,
          patientId: pid,
          patientName: pid ? names.get(pid) || pid : null,
          procedures: Number(g.procedures) || 0,
          patients: Array.isArray(g.patients) ? g.patients.length : 0,
          charges,
          paid: r2(paid),
          adjusted: r2(adjusted),
          remaining: r2(Math.max(0, charges - paid - adjusted)),
          firstDate: g.firstDate instanceof Date ? g.firstDate.toISOString() : String(g.firstDate ?? ""),
          lastDate: g.lastDate instanceof Date ? g.lastDate.toISOString() : String(g.lastDate ?? ""),
        };
      });
      return { groups, total, providers: Object.fromEntries(providerDocs.map(providerName)) };
    });
  }

  /** Close the pool now (connector replaced or removed). */
  async reset(): Promise<void> {
    await this.closeClient();
    await this.ctx.storage.deleteAlarm();
  }
}
