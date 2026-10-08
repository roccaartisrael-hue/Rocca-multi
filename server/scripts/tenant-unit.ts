// In-process checks of the tenant plumbing that is hard to reach over HTTP: webhook routing by Page id,
// config credentials never leaking across tenants, and per-tenant scheduling queues.
import fs from "fs";
import path from "path";
process.env.META_PAGE_ID = "OPERATOR_PAGE";
process.env.META_PAGE_ACCESS_TOKEN = "OPERATOR_TOKEN";
process.env.META_IG_USER_ID = "OPERATOR_IG";
process.env.ANTHROPIC_API_KEY = "x";
fs.rmSync(path.join(__dirname, "..", "data"), { recursive: true, force: true });

(async () => {
  const { config } = await import("../src/config");
  const { runAsTenant, DEFAULT_TENANT } = await import("../src/lib/tenantContext");
  const { createTenant, tenantForAccount, activeTenantIds } = await import("../src/lib/tenants");
  const { saveConnection, getConnection } = await import("../src/lib/connection");
  const { store } = await import("../src/lib/store");
  const { handleIncoming } = await import("../src/routes/api");
  let failed = 0;
  const check = (n: string, ok: boolean, x?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  -> " + JSON.stringify(x)}`); if (!ok) failed++; };

  const A = createTenant({ name: "A", email: "a@x.co", password: "password1" });
  const B = createTenant({ name: "B", email: "b@x.co", password: "password1" });
  runAsTenant(A.id, () => saveConnection({ pageId: "PAGE_A", pageName: "A", pageAccessToken: "TOKEN_A", igUserId: "IG_A", connectedAt: "" }));

  check("operator env credentials are used by the default tenant", runAsTenant(DEFAULT_TENANT, () => config.meta.pageAccessToken) === "OPERATOR_TOKEN");
  check("operator env credentials are NOT visible to another tenant", runAsTenant(B.id, () => config.meta.pageAccessToken) === "" && runAsTenant(B.id, () => config.meta.pageId) === "");
  check("a connected tenant uses its own token", runAsTenant(A.id, () => config.meta.pageAccessToken) === "TOKEN_A");
  check("page and Instagram ids route to the tenant", tenantForAccount("PAGE_A") === A.id && tenantForAccount("IG_A") === A.id);
  check("unknown page ids route nowhere", tenantForAccount("SOMEONE_ELSE") === undefined);

  // a comment for A's page lands in A's inbox only
  const id = tenantForAccount("PAGE_A")!;
  await runAsTenant(id, () => handleIncoming("facebook_comment", "c1", "שלום", "x", "תגובה בפייסבוק"));
  check("incoming comment stored in A's inbox", runAsTenant(A.id, () => store.listReplies().length) === 1);
  check("...and not in B's or the operator's", runAsTenant(B.id, () => store.listReplies().length) === 0 && runAsTenant(DEFAULT_TENANT, () => store.listReplies().length) === 0);

  // scheduling queues are per tenant and every active tenant is visited
  const past = new Date(Date.now() - 60000).toISOString();
  runAsTenant(A.id, () => store.createPost("due-A", [{ platform: "facebook", text: "t", status: "pending" }], past));
  runAsTenant(B.id, () => store.createPost("future-B", [{ platform: "facebook", text: "t", status: "pending" }], new Date(Date.now() + 3600000).toISOString()));
  check("due posts are per tenant", runAsTenant(A.id, () => store.dueScheduledPosts().length) === 1 && runAsTenant(B.id, () => store.dueScheduledPosts().length) === 0);
  check("the scheduler visits the default tenant and every active account", activeTenantIds().includes(DEFAULT_TENANT) && activeTenantIds().includes(A.id) && activeTenantIds().includes(B.id));
  check("connection is per tenant", !!runAsTenant(A.id, () => getConnection()) && !runAsTenant(B.id, () => getConnection()));

  fs.rmSync(path.join(__dirname, "..", "data"), { recursive: true, force: true });
  console.log(failed ? `\n${failed} FAILED` : "\nall unit checks passed");
  process.exit(failed ? 1 : 0);
})();
