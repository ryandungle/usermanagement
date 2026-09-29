import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { ROLE_LABEL } from "@usermanagement/shared";
import { signOut, useSession } from "../lib/auth-client";
import { MeProvider, useMe } from "../lib/me";

export function Layout() {
  return (
    <MeProvider>
      <Shell />
    </MeProvider>
  );
}

function Shell() {
  const { data: session, isPending } = useSession();
  const { me } = useMe();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login" });
  }

  return (
    <>
      <nav className="nav">
        <Link to="/" className="brand">
          User Management
        </Link>
        {session?.user && (
          <>
            <Link to="/">Profile</Link>
            {me && me.actor.role !== "user" && <Link to="/org">Organization</Link>}
            {me?.permissions.canManageUsers && <Link to="/users">Users</Link>}
            <span className="spacer" />
            <span className="muted">
              {session.user.email}
              {me && <span className="badge" style={{ marginLeft: 8 }}>{ROLE_LABEL[me.actor.role]}</span>}
            </span>
            <button className="btn sm" onClick={handleSignOut}>
              Sign out
            </button>
          </>
        )}
        {!session?.user && !isPending && (
          <>
            <span className="spacer" />
            <Link to="/login">Sign in</Link>
          </>
        )}
      </nav>
      <Outlet />
    </>
  );
}
