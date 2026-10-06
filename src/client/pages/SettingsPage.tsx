import { JiraConfigForm } from "@/client/components/settings/JiraConfigForm";
import { GitHubConfigForm } from "@/client/components/settings/GitHubConfigForm";
import { RepositoryList } from "@/client/components/settings/RepositoryList";
import { StatusCategoriesForm } from "@/client/components/settings/StatusCategoriesForm";
import { TeamChannelList } from "@/client/components/settings/TeamChannelList";
import { UsernameListForm } from "@/client/components/settings/UsernameListForm";
import { CodeownerTeamsForm } from "@/client/components/settings/CodeownerTeamsForm";
import { ChoreModelsForm } from "@/client/components/settings/ChoreModelsForm";
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
          <UsernameListForm settingKey="team_members" label="team members" />
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-4">VIPs</h2>
          <p className="text-sm text-muted-foreground mb-4">
            GitHub usernames you always want to unblock first. Review requests authored by them are highlighted on the Reviews page.
          </p>
          <UsernameListForm settingKey="vip_members" label="VIPs" />
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-4">Ignored Authors</h2>
          <p className="text-sm text-muted-foreground mb-4">
            GitHub usernames (e.g. bots) whose PRs you never want to review. Their review requests are hidden from the Reviews page.
          </p>
          <UsernameListForm settingKey="ignored_members" label="ignored authors" />
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

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-4">Chore Models</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Default model and effort pre-selected when starting an AI session for each chore.
          </p>
          <ChoreModelsForm />
        </section>
      </div>
    </div>
  );
}
