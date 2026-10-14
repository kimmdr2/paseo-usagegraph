import { type PluginClientContext, type PluginPopoverProps, type PluginSidebarItemProps, usePaseo } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

type Theme = PluginSidebarItemProps["theme"];
type UsagePayload = Awaited<ReturnType<PluginClientContext["paseo"]["providers"]["listUsage"]>>;
type ProviderUsage = UsagePayload["providers"][number];
type UsageWindow = ProviderUsage["windows"][number];

const MINUTE = 60_000;
const PROVIDERS = [
  { id: "claude", name: "Claude" },
  { id: "codex", name: "Codex" },
] as const;

function useUsage(hostId: string) {
  const paseo = usePaseo();
  return useQuery({
    queryKey: ["sidebar-usage-graphs", hostId],
    queryFn: () => paseo.providers.listUsage(),
    refetchInterval: MINUTE,
    staleTime: MINUTE,
    retry: false,
  });
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function readProvider(provider: ProviderUsage | undefined) {
  const windows = provider?.status === "available" ? provider.windows : [];
  const fiveHour = windows.find((usageWindow) => usageWindow.id === "five_hour");
  const weekly = windows.find((usageWindow) => usageWindow.id === "weekly");
  return { fiveHour, weekly, ok: Boolean(fiveHour || weekly) };
}

function percentOf(usageWindow?: UsageWindow) {
  const value = usageWindow?.usedPct;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function formatPercent(percent: number | null) {
  return percent === null ? "—" : `${Math.round(percent)}%`;
}

const SCALE = {
  dark: ["#60A5FA", "#4ADE80", "#FACC15", "#F87171"],
  light: ["#2563EB", "#16A34A", "#CA8A04", "#DC2626"],
};
const STOPS = [0, 35, 65, 90];

function channels(color: string) {
  const hex = color.trim().match(/^#([0-9a-f]{6})/i)?.[1];
  if (hex) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const rgb = color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number);
  return rgb?.length === 3 ? rgb : null;
}

function isDark(theme: Theme) {
  const rgb = channels(theme.colors.surface0) ?? [0, 0, 0];
  return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 128;
}

/** Blue → green → yellow → red as usage climbs, blended between stops. */
function usageColor(theme: Theme, percent: number | null) {
  const colors = SCALE[isDark(theme) ? "dark" : "light"];
  const value = percent ?? 0;
  const i = Math.max(0, STOPS.findIndex((stop, index) => value <= (STOPS[index + 1] ?? Infinity)));
  if (i >= STOPS.length - 1) return colors[colors.length - 1];
  const t = Math.min(1, Math.max(0, (value - STOPS[i]) / (STOPS[i + 1] - STOPS[i])));
  const from = channels(colors[i])!;
  const to = channels(colors[i + 1])!;
  return `rgb(${from.map((c, k) => Math.round(c + (to[k] - c) * t)).join(", ")})`;
}

function Bar({ percent, theme, height }: { percent: number | null; theme: Theme; height: number }) {
  return (
    <View style={{ flex: 1, height, borderRadius: height / 2, overflow: "hidden" }}>
      <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.colors.foreground, opacity: 0.1 }} />
      {percent !== null && percent > 0 && (
        <View style={{ width: `${percent}%`, minWidth: height, height: "100%", borderRadius: height / 2, backgroundColor: usageColor(theme, percent) }} />
      )}
    </View>
  );
}

function formatReset(resetsAt: string | null | undefined, now: number) {
  const at = resetsAt ? Date.parse(resetsAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const minutes = Math.max(0, Math.ceil((at - now) / MINUTE));
  if (minutes < 1) return "곧 초기화";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}일${hours ? ` ${hours}시간` : ""} 후 초기화`;
  if (hours > 0) return `${hours}시간${mins ? ` ${mins}분` : ""} 후 초기화`;
  return `${mins}분 후 초기화`;
}

function Cell({ label, usageWindow, theme }: { label: string; usageWindow?: UsageWindow; theme: Theme }) {
  const percent = percentOf(usageWindow);
  return (
    <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted, opacity: 0.8 }}>{label}</Text>
      <Bar percent={percent} theme={theme} height={4} />
      <Text style={{ minWidth: 28, textAlign: "right", fontSize: 12, fontWeight: "500", color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>
        {formatPercent(percent)}
      </Text>
    </View>
  );
}

function Row({ name, provider, theme, loading }: { name: string; provider?: ProviderUsage; theme: Theme; loading: boolean }) {
  const { fiveHour, weekly, ok } = readProvider(provider);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 22 }}>
      <Text numberOfLines={1} style={{ width: 54, fontSize: 12, fontWeight: "600", color: theme.colors.foreground }}>{name}</Text>
      {ok || loading ? (
        <>
          <Cell label="5h" usageWindow={fiveHour} theme={theme} />
          <Cell label="1w" usageWindow={weekly} theme={theme} />
        </>
      ) : (
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.colors.foregroundMuted }}>연결 필요</Text>
      )}
    </View>
  );
}

function DetailRow({ label, usageWindow, theme, now }: { label: string; usageWindow?: UsageWindow; theme: Theme; now: number }) {
  const percent = percentOf(usageWindow);
  const reset = formatReset(usageWindow?.resetsAt, now);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ fontSize: 13, color: theme.colors.foreground }}>{label}</Text>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.colors.foregroundMuted }}>{reset ?? ""}</Text>
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{formatPercent(percent)}</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel={`${label} ${formatPercent(percent)}`}
        accessibilityValue={percent === null ? { text: "조회되지 않음" } : { min: 0, max: 100, now: Math.round(percent) }}
        style={{ flexDirection: "row" }}>
        <Bar percent={percent} theme={theme} height={6} />
      </View>
    </View>
  );
}

function UsagePopover({ theme, host }: PluginPopoverProps) {
  const query = useUsage(host.id);
  const now = useNow();
  const providers = query.data?.providers ?? [];
  return (
    <View style={{ minWidth: 280, paddingHorizontal: 4, paddingVertical: 2, gap: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme.colors.foreground }}>사용량</Text>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: theme.colors.foregroundMuted }}>{host.label}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="새로고침" hitSlop={8}
          disabled={query.isFetching} onPress={() => { void query.refetch(); }}
          style={({ hovered }: { hovered?: boolean; pressed: boolean }) => ({
            width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center",
            backgroundColor: hovered ? theme.colors.surface2 : "transparent", opacity: query.isFetching ? 0.4 : 1,
          })}>
          <Text style={{ fontSize: 15, color: theme.colors.foregroundMuted }}>↻</Text>
        </Pressable>
      </View>
      {PROVIDERS.map(({ id, name }) => {
        const provider = providers.find((item) => item.providerId === id);
        const { fiveHour, weekly, ok } = readProvider(provider);
        return (
          <View key={id} style={{ gap: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foregroundMuted }}>{name}</Text>
            {ok ? (
              <>
                <DetailRow label="5시간" usageWindow={fiveHour} theme={theme} now={now} />
                <DetailRow label="주간" usageWindow={weekly} theme={theme} now={now} />
              </>
            ) : (
              <Text style={{ fontSize: 13, color: theme.colors.foregroundMuted }}>
                {query.isPending ? "불러오는 중…" : provider?.error ?? "로그인 또는 연결을 확인해 주세요."}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

export function UsageGraphs({ theme, host, layout, openPopover }: PluginSidebarItemProps) {
  const query = useUsage(host.id);
  const providers = query.data?.providers ?? [];
  const summary = PROVIDERS.map(({ id, name }) => {
    const { fiveHour, weekly } = readProvider(providers.find((provider) => provider.providerId === id));
    return `${name} 5시간 ${formatPercent(percentOf(fiveHour))}, 주간 ${formatPercent(percentOf(weekly))}`;
  }).join(". ");
  return (
    <View style={{ width: "100%", paddingHorizontal: layout.compact ? 4 : 6, paddingVertical: 4 }}>
      <Pressable onPress={() => openPopover(UsagePopover)} accessibilityRole="button" accessibilityLabel={`사용량: ${summary}`}
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
          paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, gap: 2,
          backgroundColor: pressed ? theme.colors.surface2 : hovered ? theme.colors.surface1 : "transparent",
        })}>
        {PROVIDERS.map(({ id, name }) => (
          <Row key={id} name={name} theme={theme} loading={query.isPending}
            provider={providers.find((provider) => provider.providerId === id)} />
        ))}
      </Pressable>
    </View>
  );
}
