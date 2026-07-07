import { redirect } from "next/navigation";

// The sign-in surface moved to /team (unlinked from the public landing page).
// This redirect keeps old bookmarks and Slack-configured URLs working.
export default function LoginRedirect() {
  redirect("/team");
}
