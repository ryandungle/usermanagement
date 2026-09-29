import type { Db } from "mongodb";
import type { PmsMapping, PmsType } from "@usermanagement/shared";
import type { PatientDetail, PatientSummary, ProcedureFilters, ProcedureGroup, ProcedureGroupBy, ProcedureRow } from "../lib/denticon.js";

export interface PmsConfig {
  type: PmsType;
  /** Fully resolved collection names (defaults + office overrides). */
  mapping: PmsMapping;
}

export interface PatientListQuery {
  q?: string;
  page: number;
  pageSize: number;
  activeOnly?: boolean;
  sort?: string;
  order?: "asc" | "desc";
  dateRange?: { field: "lastVisitDate" | "birthDate"; from?: string; to?: string };
}

export interface SortSpec {
  field: string;
  order: "asc" | "desc";
}

export interface ProcedureListResult {
  rows: ProcedureRow[];
  total: number;
  providers: Record<string, string>;
}

export interface ProcedureGroupResult {
  groups: ProcedureGroup[];
  total: number;
  providers: Record<string, string>;
}

/** Everything the patient/procedure pages need, implemented per practice-management system. */
export interface PmsAdapter {
  listPatients(db: Db, m: PmsMapping, query: PatientListQuery): Promise<{ patients: PatientSummary[]; total: number }>;
  getPatient(db: Db, m: PmsMapping, patientId: string): Promise<PatientDetail | null>;
  listProcedures(db: Db, m: PmsMapping, filters: ProcedureFilters, page: number, pageSize: number, sort?: SortSpec): Promise<ProcedureListResult>;
  groupProcedures(db: Db, m: PmsMapping, groupBy: Exclude<ProcedureGroupBy, "none">, filters: ProcedureFilters, page: number, pageSize: number, sort?: SortSpec): Promise<ProcedureGroupResult>;
}

/** Shared string-range + date-range matcher for fields stored as either. */
export function dateFieldRange(field: string, from?: string, to?: string): Record<string, unknown> | null {
  if (!from && !to) return null;
  const asDate: Record<string, unknown> = {};
  const asString: Record<string, unknown> = {};
  if (from) {
    asDate.$gte = new Date(`${from}T00:00:00.000Z`);
    asString.$gte = from;
  }
  if (to) {
    asDate.$lte = new Date(`${to}T23:59:59.999Z`);
    asString.$lte = `${to}￿`;
  }
  return { $or: [{ [field]: asDate }, { [field]: asString }] };
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const round2 = (n: number) => Math.round(n * 100) / 100;
