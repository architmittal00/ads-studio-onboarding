import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphGetAllPages } from "@/lib/facebookGraph";

// `business{id,name}` on an ad account requires the `business_management`
// permission to read — a scope this app has never requested in its OAuth
// `scope` string (see pages/api/auth/[...nextauth].js), so no token this app
// issues can ever carry it. Reported by a real user: `/me/adaccounts` came
// back entirely empty with "(#100) Requires business_management permission
// to access the field" — Graph fails the WHOLE list, not just that one
// field, the moment any ad account in it belongs to a Business Manager.
// This is why it can look like it "works for other users" purely by
// coincidence: a personal (non-Business-Manager) ad account has nothing to
// check that permission against, so the same request with the same token
// succeeds — nothing to do with which device or session is used.
//
// Rather than adding `business_management` to the OAuth scope (its own
// Advanced-Access gate, same as pages_show_list/ads_read, plus it would
// force every existing user to re-consent on their next login), this
// degrades gracefully instead: retry without `business{id,name}` so the
// user still sees their real ad accounts. Partnership Ads already treats a
// missing Business id as a normal, handled state (its own "not associated
// with a Business Manager" message) — same fallback, just reached via a
// permission gap instead of a genuinely BM-less account.
async function fetchAdAccounts(token) {
  try {
    const result = await graphGetAllPages("/me/adaccounts", token, {
      fields: "id,name,account_status,currency,business{id,name}",
    });
    return { data: result.data || [], error: null };
  } catch (err) {
    if (!/business_management/i.test(err.message || "")) {
      return { data: [], error: err.message };
    }
    try {
      const result = await graphGetAllPages("/me/adaccounts", token, {
        fields: "id,name,account_status,currency",
      });
      return { data: result.data || [], error: null };
    } catch (fallbackErr) {
      return { data: [], error: fallbackErr.message };
    }
  }
}

// The Businesses (Business Manager accounts) the user is actually a member
// of — confirmed via a real user's own curl against `/me/businesses` that
// this needs no permission beyond what this app already requests (no
// `business_management`, no re-login). This is deliberately the source of
// truth for Partnership Ads' Business picker instead of the `business{id,
// name}` sub-field on `/me/adaccounts` above: that field just reports which
// Business *owns* a given ad account, which can be a Business the user has
// no real access to at all (an ad account can be shared with someone
// directly without the ad account's own Business granting them anything) —
// reported by the user, who found the picker offering a Business they
// couldn't actually use, alongside the one they could. `/me/businesses`
// reports actual membership, so it can't include one the user has no access
// to, and — being a separate, unrelated endpoint — isn't affected by the
// `business_management` permission gap `fetchAdAccounts` above has to work
// around either.
async function fetchBusinesses(token) {
  try {
    const result = await graphGetAllPages("/me/businesses", token, { fields: "id,name" });
    return { data: result.data || [], error: null };
  } catch (err) {
    return { data: [], error: err.message };
  }
}

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  // Reported by the user: a real account (a valid, working token confirmed
  // directly against Graph) saw "No Pages found"/"No Ad Accounts found" in
  // this app with nothing else to go on. Root cause of the *symptom*: these
  // two calls previously caught any failure — a genuine permission error
  // (e.g. `pages_show_list`/`ads_read` needing App Review/Advanced Access,
  // or the user not being an Admin/Developer/Tester on this Meta App — see
  // README.md's own note on this) just as readily as a transient network
  // blip — and replaced it with a plain empty array, indistinguishable from
  // "this user genuinely has zero Pages/ad accounts." Now each failure's
  // actual message is captured instead of swallowed, so the dashboard can
  // show the real reason rather than a guess.
  try {
    // Paginated to completion — an agency token managing more Pages/ad
    // accounts than fit on one page would otherwise silently lose the rest
    // from every picker in the app.
    const [profile, pages, adAccounts, businesses] = await Promise.all([
      graphGet("/me", session.accessToken, { fields: "id,name,email,picture" }),
      // instagram_business_account is only present on a Page that actually
      // has one linked — most won't, and that's a normal state (see
      // components/AccountProvider.js's igAccounts derivation), not
      // something to special-case here.
      graphGetAllPages("/me/accounts", session.accessToken, {
        fields: "id,name,category,instagram_business_account{id,username,profile_picture_url}",
      })
        .then((r) => ({ data: r.data || [], error: null }))
        .catch((err) => ({ data: [], error: err.message })),
      // `business` (the owning Business Manager) is only needed as a sane
      // first-time default for Partnership Ads' Business picker below (see
      // components/AccountProvider.js) — fetched here anyway, alongside
      // everything else this call already gets, rather than a separate round
      // trip. Absent for a personal (non-Business-Manager) ad account, same
      // "normal, handled state" treatment as instagram_business_account above
      // — see fetchAdAccounts' own comment for the other way this ends up
      // absent (a business_management permission gap, not a genuinely
      // BM-less account).
      fetchAdAccounts(session.accessToken),
      // The actual source of truth for which Businesses the user can pick —
      // see fetchBusinesses' own comment for why this isn't instead derived
      // from adAccounts' own `business` field above.
      fetchBusinesses(session.accessToken),
    ]);

    res.status(200).json({
      profile,
      pages: pages.data,
      pagesError: pages.error,
      adAccounts: adAccounts.data,
      adAccountsError: adAccounts.error,
      businesses: businesses.data,
      businessesError: businesses.error,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
