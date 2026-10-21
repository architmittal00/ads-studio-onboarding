import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { graphGet, graphGetAllPages } from "@/lib/facebookGraph";

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
    const [profile, pages, adAccounts] = await Promise.all([
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
      // `business` (the owning Business Manager) is only needed for
      // Partnership Ads' Content Discovery API, which is keyed by business
      // id rather than ad account id — fetched here anyway, alongside
      // everything else this call already gets, rather than a separate round
      // trip. Absent for a personal (non-Business-Manager) ad account, same
      // "normal, handled state" treatment as instagram_business_account above.
      graphGetAllPages("/me/adaccounts", session.accessToken, {
        fields: "id,name,account_status,currency,business{id,name}",
      })
        .then((r) => ({ data: r.data || [], error: null }))
        .catch((err) => ({ data: [], error: err.message })),
    ]);

    res.status(200).json({
      profile,
      pages: pages.data,
      pagesError: pages.error,
      adAccounts: adAccounts.data,
      adAccountsError: adAccounts.error,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
