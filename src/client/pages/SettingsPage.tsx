import { JiraConfigForm } from "@/client/components/settings/JiraConfigForm";
import { GitHubConfigForm } from "@/client/components/settings/GitHubConfigForm";
import { RepositoryList } from "@/client/components/settings/RepositoryList";
import { Separator } from "@/client/components/ui/separator";

export function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="space-y-8 max-w-2xl">
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
      </div>
    </div>
  );
}
