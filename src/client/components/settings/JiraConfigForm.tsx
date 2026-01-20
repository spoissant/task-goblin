import { useState, useEffect } from "react";
import { useJiraConfigQuery, useUpdateJiraConfig } from "@/client/lib/queries";
import { Card, CardContent } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { Textarea } from "@/client/components/ui/textarea";
import { Skeleton } from "@/client/components/ui/skeleton";
import { toast } from "sonner";

export function JiraConfigForm() {
  const { data: config, isLoading } = useJiraConfigQuery();
  const updateConfig = useUpdateJiraConfig();

  const [formData, setFormData] = useState({
    jira_host: "",
    jira_email: "",
    jira_project: "",
    jira_jql: "",
    jira_sprint_field: "customfield_10003",
  });

  useEffect(() => {
    if (config) {
      setFormData({
        jira_host: config.jira_host || "",
        jira_email: config.jira_email || "",
        jira_project: config.jira_project || "",
        jira_jql: config.jira_jql || "",
        jira_sprint_field: config.jira_sprint_field || "customfield_10003",
      });
    }
  }, [config]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateConfig.mutate(formData, {
      onSuccess: () => {
        toast.success("Jira configuration saved");
      },
      onError: () => {
        toast.error("Failed to save configuration");
      },
    });
  };

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="jira_host">Jira Host</Label>
            <Input
              id="jira_host"
              value={formData.jira_host}
              onChange={(e) => setFormData({ ...formData, jira_host: e.target.value })}
              placeholder="https://your-org.atlassian.net"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="jira_email">Jira Email</Label>
            <Input
              id="jira_email"
              type="email"
              value={formData.jira_email}
              onChange={(e) => setFormData({ ...formData, jira_email: e.target.value })}
              placeholder="your-email@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="jira_project">Jira Project Key</Label>
            <Input
              id="jira_project"
              value={formData.jira_project}
              onChange={(e) => setFormData({ ...formData, jira_project: e.target.value })}
              placeholder="PROJ"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="jira_jql">Custom JQL (optional)</Label>
            <Textarea
              id="jira_jql"
              value={formData.jira_jql}
              onChange={(e) => setFormData({ ...formData, jira_jql: e.target.value })}
              placeholder="assignee = currentUser() AND status != Done"
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use default: project = [PROJECT] AND assignee = currentUser()
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="jira_sprint_field">Sprint Field ID</Label>
            <Input
              id="jira_sprint_field"
              value={formData.jira_sprint_field}
              onChange={(e) => setFormData({ ...formData, jira_sprint_field: e.target.value })}
              placeholder="customfield_10003"
            />
            <p className="text-xs text-muted-foreground">
              The custom field ID for the sprint field (default: customfield_10003)
            </p>
          </div>

          <Button type="submit" disabled={updateConfig.isPending}>
            {updateConfig.isPending ? "Saving..." : "Save Configuration"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
