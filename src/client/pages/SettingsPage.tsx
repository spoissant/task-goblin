import { JiraConfigForm } from "@/client/components/settings/JiraConfigForm";
import { GitHubConfigForm } from "@/client/components/settings/GitHubConfigForm";
import { RepositoryList } from "@/client/components/settings/RepositoryList";
import { StatusCategoriesForm } from "@/client/components/settings/StatusCategoriesForm";
import { TeamChannelList } from "@/client/components/settings/TeamChannelList";
import { TeamMembersForm } from "@/client/components/settings/TeamMembersForm";
import { VipMembersForm } from "@/client/components/settings/VipMembersForm";
import { CodeownerTeamsForm } from "@/client/components/settings/CodeownerTeamsForm";
import { Separator } from "@/client/components/ui/separator";

export function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="space-y-8">
        <section>
          <h2 className="text-lg font-semibold mb-4">Jira Configuration</h2>
          <JiraConfigForm />
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-4">GitHub Configuration</h2>
          <GitHubConfigForm />
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-4">GitHub Repositories</h2>
          <RepositoryList />
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-4">Team Members</h2>
          <p className="text-sm text-muted-foreground mb-4">
            GitHub usernames of your teammates. Review requests authored by them are highlighted on the Reviews page.
          </p>
          <TeamMembersForm />
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-4">VIPs</h2>
          <p className="text-sm text-muted-foreground mb-4">
            GitHub usernames you always want to unblock first. Review requests authored by them are highlighted on the Reviews page.
          </p>
          <VipMembersForm />
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-4">Code Owner Teams</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Your GitHub teams, read straight from the token. The Code Owners column on the Reviews page
            flags PRs the selected teams own but haven't reviewed yet. All teams count until you narrow it.
          </p>
          <CodeownerTeamsForm />
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-4">Team Channel Mappings</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Map GitHub team slugs to Slack channels. When a PR has CODEOWNERS review requests, the goblin chore runner will notify the matching channels.
          </p>
          <TeamChannelList />
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-4">Status Categories</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Configure status colors and which statuses are considered "done". Tasks are sorted by category order.
          </p>
          <StatusCategoriesForm />
        </section>
      </div>
    </div>
  );
}
