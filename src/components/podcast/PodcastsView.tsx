import { useState, useEffect, useCallback } from "react";
import type { PodcastShow } from "../../types/podcast";
import { searchPodcasts, getTrending } from "../../lib/podcast";
import { usePodcastStore } from "../../stores/podcast";
import { PodcastCard } from "./PodcastCard";
import { EpisodeList } from "./EpisodeList";
import { ViewHeader } from "../shared/ViewHeader";
import { Tabs, tabPanelProps } from "../shared/Tabs";

type Tab = "subscriptions" | "trending" | "search";

export function PodcastsView() {
  const subscriptions = usePodcastStore((s) => s.subscriptions);
  const hasSubscriptions = subscriptions.length > 0;
  const [tab, setTab] = useState<Tab>(hasSubscriptions ? "subscriptions" : "trending");
  const [query, setQuery] = useState("");
  const [shows, setShows] = useState<PodcastShow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedShow, setSelectedShow] = useState<PodcastShow | null>(null);

  // Load trending on mount if no subscriptions
  useEffect(() => {
    if (hasSubscriptions) return;
    setLoading(true);
    getTrending().then((results) => {
      setShows(results);
      setLoading(false);
    });
  }, []);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setTab("search");
    setLoading(true);
    const results = await searchPodcasts(query.trim());
    setShows(results);
    setLoading(false);
  }, [query]);

  const handleTabChange = useCallback(async (t: Tab) => {
    setTab(t);
    setSelectedShow(null);
    if (t === "trending") {
      setLoading(true);
      const results = await getTrending();
      setShows(results);
      setLoading(false);
    }
  }, []);

  // Show episode list if a show is selected
  if (selectedShow) {
    return <EpisodeList show={selectedShow} onBack={() => setSelectedShow(null)} />;
  }

  const displayShows = tab === "subscriptions" ? subscriptions : shows;

  return (
    <div className="h-full flex flex-col">
      <ViewHeader title="Podcasts">
        {/* The field and its button stay together, beside the title. */}
        <div className="flex items-center gap-2 w-full max-w-lg">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search podcasts…"
            className="flex-1 min-w-0 bg-bg-raised border border-border-strong rounded-lg px-3 py-1.5 text-ui text-text placeholder:text-text-dim focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleSearch}
            disabled={!query.trim()}
            className="px-3 py-1.5 bg-accent/10 text-accent text-ui rounded-sm hover:bg-accent/20 transition-colors disabled:opacity-40"
          >
            Search
          </button>
        </div>
      </ViewHeader>
      <Tabs
        label="Podcasts"
        panel="podcasts-panel"
        tabs={[
          { id: "subscriptions", label: "My Podcasts", count: subscriptions.length || undefined },
          { id: "trending", label: "Trending" },
          { id: "search", label: "Search Results" },
        ]}
        value={tab}
        onChange={handleTabChange}
      />

      {/* Results */}
      <div {...tabPanelProps("podcasts-panel", tab)} className="flex-1 overflow-y-auto p-4">
        {tab === "subscriptions" ? (
          subscriptions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-dim text-body mb-2">No subscriptions yet.</p>
              <p className="text-text-dim text-caption">Search for a podcast or browse trending to subscribe.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {subscriptions.map((show, i) => (
                <PodcastCard
                  key={show.feedUrl ?? i}
                  show={show}
                  onClick={() => setSelectedShow(show)}
                />
              ))}
            </div>
          )
        ) : loading ? (
          <div className="text-text-dim text-body">Loading…</div>
        ) : displayShows.length === 0 ? (
          <div className="text-text-dim text-body">
            {tab === "search" ? "No results. Try a different search." : "No trending podcasts found."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {displayShows.map((show, i) => (
              <PodcastCard
                key={show.podcastIndexId ?? i}
                show={show}
                onClick={() => setSelectedShow(show)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
