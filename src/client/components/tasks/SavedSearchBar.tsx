import { useState } from "react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { Plus, X } from "lucide-react";

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  active: boolean;
}

/**
 * AND two search queries. The search syntax has no parentheses, so the OR groups
 * are distributed: (a | b) & (c | d) becomes a & c | a & d | b & c | b & d.
 */
export function andQueries(left: string, right: string): string {
  const groups = (q: string) => q.split("|").map((g) => g.trim()).filter(Boolean);
  const l = groups(left);
  const r = groups(right);
  if (l.length === 0) return r.join(" | ");
  if (r.length === 0) return l.join(" | ");
  return l.flatMap((a) => r.map((b) => `${a} & ${b}`)).join(" | ");
}

/** Active saved searches are OR'd together (union of groups), then AND'd with the typed search. */
export function effectiveQuery(typed: string, saved: SavedSearch[]): string {
  const activeUnion = saved
    .filter((s) => s.active)
    .map((s) => s.query)
    .join(" | ");
  return andQueries(typed, activeUnion);
}

interface SavedSearchBarProps {
  searches: SavedSearch[];
  onChange: (searches: SavedSearch[]) => void;
}

export function SavedSearchBar({ searches, onChange }: SavedSearchBarProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const canSave = name.trim() !== "" && query.trim() !== "";

  const handleSave = () => {
    if (!canSave) return;
    onChange([...searches, { id: crypto.randomUUID(), name: name.trim(), query: query.trim(), active: false }]);
    setName("");
    setQuery("");
    setDialogOpen(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {searches.map((s) => (
        <Badge
          key={s.id}
          variant={s.active ? "default" : "outline"}
          title={s.query}
          className="text-xs cursor-pointer gap-1 pr-1"
          onClick={() => onChange(searches.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x)))}
        >
          {s.name}
          <button
            type="button"
            title="Delete saved search"
            className="rounded-sm opacity-60 hover:opacity-100 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onChange(searches.filter((x) => x.id !== s.id));
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <button
        type="button"
        title="Add saved search"
        onClick={() => setDialogOpen(true)}
        className="cursor-pointer"
      >
        <Badge variant="outline" className="text-xs text-muted-foreground hover:text-foreground">
          <Plus />
          Saved search
        </Badge>
      </button>

      <ModalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Add Saved Search"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave}>
              Save
            </Button>
          </>
        }
      >
        <form
          className="space-y-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="saved-search-name">Name</Label>
            <Input id="saved-search-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="saved-search-query">Search query</Label>
            <Input
              id="saved-search-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. tiptap | editor & ~bug"
            />
          </div>
          {/* Hidden submit so Enter in either field saves */}
          <button type="submit" hidden />
        </form>
      </ModalDialog>
    </div>
  );
}
