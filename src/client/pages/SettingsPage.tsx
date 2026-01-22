import { JiraConfigForm } from "@/client/components/settings/JiraConfigForm";
import { GitHubConfigForm } from "@/client/components/settings/GitHubConfigForm";
import { RepositoryList } from "@/client/components/settings/RepositoryList";
import { StatusCategoriesForm } from "@/client/components/settings/StatusCategoriesForm";
import { TaskFiltersForm } from "@/client/components/settings/TaskFiltersForm";
import { Separator } from "@/client/components/ui/separator";

export function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="space-y-8 max-w-4xl">
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
          <h2 className="text-lg font-semibold mb-4">Status Categories</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Configure status colors and which statuses are considered "done". Tasks are sorted by category order.
          </p>
          <StatusCategoriesForm />
        </section>

        <Separator />

        <section>
          <h2 className="text-lg font-semibold mb-4">Task Filters</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Configure filter tabs shown on the Tasks page. Each filter shows tasks matching the included statuses.
          </p>
          <TaskFiltersForm />
        </section>
      </div>
    </div>
  );
}
