import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { signOut, useSession } from "../lib/auth-client";

export function Layout() {
  const { data: session, isPending } = useSession();
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
            {session.user.role === "admin" && <Link to="/users">Users</Link>}
            <span className="spacer" />
            <span className="muted">{session.user.email}</span>
            <button className="btn sm" onClick={handleSignOut}>
              Sign out
            </button>
          </>
        )}
        {!session?.user && !isPending && (
          <>
            <span className="spacer" />
            <Link to="/login">Sign in</Link>
            <Link to="/register">Create account</Link>
          </>
        )}
      </nav>
      <Outlet />
    </>
  );
}
