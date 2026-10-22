import { useMemo, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useReviewRequestsQuery, reviewKeys, type ReviewScope } from "@/client/lib/queries/reviews";
import { useRepositoriesQuery } from "@/client/lib/queries/repositories";
import { useLatestSessionsQuery, useReviewSessionsQuery } from "@/client/lib/queries/sessions";
import { ReviewTable } from "@/client/components/reviews/ReviewTable";
import { SizeHeading } from "@/client/components/reviews/SizeBadge";
import { isSessionActive } from "@/client/lib/sessions";
import { useSettingsQuery, useUpdateSetting } from "@/client/lib/queries/settings";
import { useLocalStorage } from "@/client/lib/useLocalStorage";
import {
  HIGH_PRIORITY_PRS_SETTING,
  IGNORED_MEMBERS_SETTING,
  TEAM_MEMBERS_SETTING,
  VIP_MEMBERS_SETTING,
} from "@/shared/settings-keys";
import { parseStringList } from "@/shared/json";
import { isIgnoredRequest, isMostlyBackend, isReviewSatisfied, parseUsernames } from "@/client/lib/review-ownership";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Button } from "@/client/components/ui/button";
import { FilterToggle } from "@/client/components/ui/filter-toggle";
import { Tabs, TabsList, TabsTrigger } from "@/client/components/ui/tabs";
import { EmptyState } from "@/client/components/ui/empty-state";
import { RefreshCw, GitPullRequestArrow } from "lucide-react";
import type { ClaudeSession, PrSize, ReviewRequest, Repository } from "@/shared/types";
import { categorizePrSize } from "@/shared/pr-size";

type ViewMode = "grouped" | "flat";

const SIZE_ORDER: PrSize[] = ["small", "medium", "large"];

const byCreatedAt = (a: ReviewRequest, b: ReviewRequest) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

export function ReviewsPage() {
  const queryClient = useQueryClient();

  const [scope, setScope] = useLocalStorage<ReviewScope>("reviewsPage.scope", "others");
  const [view, setView] = useLocalStorage<ViewMode>("reviewsPage.view", "grouped");
  const [hideReadyToMerge, setHideReadyToMerge] = useLocalStorage("reviewsPage.hideReadyToMerge", true);
  const [showIgnored, setShowIgnored] = useLocalStorage("reviewsPage.showIgnored", false);
  const [hideBackend, setHideBackend] = useLocalStorage("reviewsPage.hideBackend", false);

  const { data, isLoading, error, isFetching } = useReviewRequestsQuery(scope);
  const { data: reposData } = useRepositoriesQuery();
  const { data: settings } = useSettingsQuery();
  const updateSetting = useUpdateSetting();
  const teamMembers = useMemo(() => parseUsernames(settings?.[TEAM_MEMBERS_SETTING]), [settings?.[TEAM_MEMBERS_SETTING]]);
  const vips = useMemo(() => parseUsernames(settings?.[VIP_MEMBERS_SETTING]), [settings?.[VIP_MEMBERS_SETTING]]);
  const ignored = useMemo(() => parseUsernames(settings?.[IGNORED_MEMBERS_SETTING]), [settings?.[IGNORED_MEMBERS_SETTING]]);
  const highPriorityPrs = useMemo(
    () => new Set(parseStringList(settings?.[HIGH_PRIORITY_PRS_SETTING])),
    [settings],
  );

  const toggleHighPriority = (key: string) => {
    const next = new Set(highPriorityPrs);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    updateSetting.mutate({ key: HIGH_PRIORITY_PRS_SETTING, value: JSON.stringify([...next]) });
  };

  const repoBySlug = useMemo(() => {
    const map = new Map<string, Repository>();
    if (reposData?.items) {
      for (const repo of reposData.items) {
        map.set(`${repo.owner}/${repo.repo}`, repo);
      }
    }
    return map;
  }, [reposData]);

  const visibleItems = useMemo(() => {
    if (!data?.items) return null;
    // Own drafts are WIP worth seeing; others' drafts aren't reviewable yet.
    // Others' PRs your review can't move don't need it, so they can be hidden
    // too, as can mostly-backend PRs. Ignored authors' (bots') unassigned PRs
    // only show when asked for.
    if (scope === "mine") return data.items;
    return data.items.filter(
      (item) =>
        !item.isDraft &&
        (showIgnored || !isIgnoredRequest(item, ignored)) &&
        !(hideReadyToMerge && isReviewSatisfied(item)) &&
        !(hideBackend && isMostlyBackend(item)),
    );
  }, [data, scope, hideReadyToMerge, showIgnored, hideBackend, ignored]);

  const groups = useMemo(() => {
    if (!visibleItems) return null;
    const grouped: Record<PrSize, ReviewRequest[]> = { small: [], medium: [], large: [] };
    for (const item of visibleItems) {
      grouped[categorizePrSize(item.additions, item.deletions)].push(item);
    }
    for (const size of SIZE_ORDER) grouped[size].sort(byCreatedAt);
    return grouped;
  }, [visibleItems]);

  const flatItems = useMemo(() => (visibleItems ? [...visibleItems].sort(byCreatedAt) : null), [visibleItems]);

  // Review column: task-less sessions for others' PRs, the task's code-review
  // chore for your own.
  const { data: reviewSessions } = useReviewSessionsQuery();
  const { data: taskSessions } = useLatestSessionsQuery();
  const sessionFor = useMemo(() => {
    const byPr = new Map<string, ClaudeSession>();
    for (const s of reviewSessions?.items ?? []) if (s.prUrl) byPr.set(s.prUrl, s);
    const byTask = new Map<number, ClaudeSession>();
    for (const s of taskSessions?.items ?? []) {
      if (s.taskId !== null && s.choreKey === "code-review-pr") byTask.set(s.taskId, s);
    }
    return (request: ReviewRequest) =>
      scope === "mine" ? (request.taskId != null ? byTask.get(request.taskId) : undefined) : byPr.get(request.url);
  }, [reviewSessions, taskSessions, scope]);

  // A review that just finished has likely posted a draft: refetch so its badge shows.
  const activeReviewIds = useRef(new Set<number>());
  useEffect(() => {
    const active = new Set((reviewSessions?.items ?? []).filter(isSessionActive).map((s) => s.id));
    const finished = [...activeReviewIds.current].some((id) => !active.has(id));
    activeReviewIds.current = active;
    if (finished) queryClient.invalidateQueries({ queryKey: reviewKeys.requests("others") });
  }, [reviewSessions, queryClient]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: reviewKeys.all });
  };

  const tableProps = {
    repoBySlug,
    sessionFor,
    scope,
    jiraHost: settings?.jira_host,
    teamMembers,
    vips,
    highPriorityPrs,
    onToggleHighPriority: toggleHighPriority,
  };

  return (
    <div>
      {/* Sticky: -mt-6/pt-6 pull <main>'s top padding inside so rows don't show above it once stuck. */}
      <div className="sticky top-0 z-10 -mt-6 pt-6 pb-4 bg-background">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Review Requests</h1>
          <div className="flex items-center gap-2">
            {scope === "others" && (
              <div className="flex items-center gap-4 shrink-0 mr-2">
                <FilterToggle
                  id="hide-ready-to-merge"
                  label="Hide ready to merge"
                  checked={hideReadyToMerge}
                  onCheckedChange={setHideReadyToMerge}
                />
                <FilterToggle id="show-ignored" label="Show ignored" checked={showIgnored} onCheckedChange={setShowIgnored} />
                <FilterToggle
                  id="hide-backend"
                  label="Hide backend"
                  title="Hide PRs with over 75% of changed lines in backend files"
                  checked={hideBackend}
                  onCheckedChange={setHideBackend}
                />
              </div>
            )}
            {visibleItems && (
              <span className="text-sm text-muted-foreground">
                {visibleItems.length} PR{visibleItems.length !== 1 ? "s" : ""} {scope === "mine" ? "open" : "awaiting review"}
              </span>
            )}
            <Button variant="outline" onClick={handleRefresh} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <Tabs value={scope} onValueChange={(v) => setScope(v as ReviewScope)}>
          <TabsList>
            <TabsTrigger value="others">Others' PRs</TabsTrigger>
            <TabsTrigger value="mine">My PRs</TabsTrigger>
          </TabsList>
        </Tabs>

        {visibleItems && visibleItems.length > 0 && (
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)} className="mt-4">
            <TabsList>
              <TabsTrigger value="grouped">Grouped by Size</TabsTrigger>
              <TabsTrigger value="flat">Oldest First</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {error && (
        <EmptyState message="Failed to load review requests" />
      )}

      {visibleItems && !visibleItems.length && (
        <EmptyState
          icon={GitPullRequestArrow}
          message={scope === "mine" ? "No open PRs" : "No PRs awaiting your review"}
        />
      )}

      {visibleItems && visibleItems.length > 0 && view === "grouped" && groups && (
        <div className="space-y-8">
          {SIZE_ORDER.map((size) => {
            const prs = groups[size];
            if (!prs.length) return null;
            return (
              <div key={size}>
                <SizeHeading size={size} count={prs.length} />
                <ReviewTable items={prs} showSize={false} {...tableProps} />
              </div>
            );
          })}
        </div>
      )}

      {visibleItems && visibleItems.length > 0 && view === "flat" && flatItems && (
        <ReviewTable items={flatItems} showSize={true} {...tableProps} />
      )}
    </div>
  );
}
