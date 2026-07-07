# TODO — User invites via Resend (email onboarding)

Captured 2026-07-07 while splitting the public landing page from the sign-in surface.

## Context

- `/` is now a public, informative open-source landing page (GitHub, quick start,
  contributing). It intentionally has **no** sign-in link.
- `/team` is the unlinked ("secret") sign-in page for the workspace that installed the
  app; `/login` 308-redirects there for old bookmarks. Auth.js `pages.signIn` points at
  `/team`.
- Today, anyone in the installing Slack workspace who finds `/team` can sign in and is
  provisioned as a **viewer** (first-ever login becomes admin). There is no invite step.

## Planned feature

Add [Resend](https://resend.com) as the email mechanism for onboarding users:

- [ ] Admin can invite a person by email from the dashboard (People page).
- [ ] Invite email (via Resend) contains a link pointing the invitee at `/team` —
      possibly with a signed, expiring invite token in the URL.
- [ ] On sign-in, an invite token (or a pending-invite row matched by email) provisions
      the user as **viewer** (or the role chosen on the invite).
- [ ] Onboarding flow: the installing admin receives an "invite your team" prompt /
      link as part of setup.
- [ ] Decide: should uninvited workspace members still be allowed to self-serve sign in
      at `/team`, or should sign-in require a pending invite once the feature ships?

## Related hardening (separate, discussed same day)

- Validate the `https://slack.com/team_id` OIDC claim against a `SLACK_TEAM_ID` env var
  in the `signIn` callback, so sign-in stays scoped to the installing workspace even if
  the Slack app ever enables public distribution.
