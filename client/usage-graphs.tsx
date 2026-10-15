import { type PluginClientContext, type PluginPopoverProps, type PluginSidebarItemProps, usePaseo } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";

type Theme = PluginSidebarItemProps["theme"];
type UsagePayload = Awaited<ReturnType<PluginClientContext["paseo"]["providers"]["listUsage"]>>;
type ProviderUsage = UsagePayload["providers"][number];
type UsageWindow = ProviderUsage["windows"][number];
type UsageQuery = ReturnType<typeof useUsage>;
type AccountState = "loading" | "failed" | "missing" | "error" | "unavailable" | "no_windows" | "ok";

const MINUTE = 60_000;
const SPIN_MS = 800;
const DONE_MS = 1800;
const PROVIDERS = [
  { id: "claude", name: "Claude" },
  { id: "codex", name: "Codex" },
] as const;

/** Short sidebar wording for every state that has no numbers to show. */
const STATE_SHORT: Record<Exclude<AccountState, "ok" | "loading">, string> = {
  failed: "불러오지 못함",
  missing: "정보 없음",
  error: "일시적 오류",
  unavailable: "사용 불가",
  no_windows: "표시할 구간 없음",
};

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

function windowsOf(provider: ProviderUsage | undefined) {
  const windows = provider?.status === "available" ? provider.windows : [];
  return {
    windows,
    fiveHour: windows.find((usageWindow) => usageWindow.id === "five_hour"),
    weekly: windows.find((usageWindow) => usageWindow.id === "weekly"),
  };
}

function hasMainWindows(provider: ProviderUsage) {
  const { fiveHour, weekly } = windowsOf(provider);
  return Boolean(fiveHour || weekly);
}

/** One provider can report several accounts; the sidebar shows the first one that has numbers. */
function accountsOf(providers: readonly ProviderUsage[], id: string) {
  const accounts = providers.filter((provider) => provider.providerId === id);
  const primary = accounts.find(hasMainWindows) ?? accounts.find((provider) => provider.status === "available") ?? accounts[0];
  return { accounts, primary };
}

function stateOf(provider: ProviderUsage | undefined, query: UsageQuery): AccountState {
  if (!query.data) return query.isError ? "failed" : "loading";
  if (!provider) return "missing";
  if (provider.status === "error") return "error";
  if (provider.status === "unavailable") return "unavailable";
  return hasMainWindows(provider) ? "ok" : "no_windows";
}

function clampPct(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

/** Share of the limit still left; derived from usedPct when the provider omits remainingPct. */
function remainingOf(usageWindow?: UsageWindow) {
  const remaining = clampPct(usageWindow?.remainingPct);
  if (remaining !== null) return remaining;
  const used = clampPct(usageWindow?.usedPct);
  return used === null ? null : 100 - used;
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

function mix(from: string, to: string, amount: number) {
  const a = channels(from);
  const b = channels(to);
  if (!a || !b) return from;
  return `rgb(${a.map((c, k) => Math.round(c + (b[k] - c) * amount)).join(", ")})`;
}

function isDark(theme: Theme) {
  const rgb = channels(theme.colors.surface0) ?? [0, 0, 0];
  return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 128;
}

/** The host's muted ink nudged toward the foreground so small labels clear 4.5:1 in both themes. */
function secondaryText(theme: Theme) {
  return mix(theme.colors.foregroundMuted, theme.colors.foreground, 0.3);
}

/** Blue → green → yellow → red as usage climbs (i.e. as what is left shrinks), blended between stops. */
function usageColor(theme: Theme, percent: number | null) {
  const colors = SCALE[isDark(theme) ? "dark" : "light"];
  const value = percent ?? 0;
  const i = Math.max(0, STOPS.findIndex((stop, index) => value <= (STOPS[index + 1] ?? Infinity)));
  if (i >= STOPS.length - 1) return colors[colors.length - 1];
  const t = Math.min(1, Math.max(0, (value - STOPS[i]) / (STOPS[i + 1] - STOPS[i])));
  return mix(colors[i], colors[i + 1], t);
}

/** Fills with what is left, like a battery. */
function Bar({ remaining, theme, height }: { remaining: number | null; theme: Theme; height: number }) {
  return (
    <View style={{ flex: 1, height, borderRadius: height / 2, overflow: "hidden" }}>
      <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.colors.foreground, opacity: 0.1 }} />
      {remaining !== null && remaining > 0 && (
        <View style={{ width: `${remaining}%`, minWidth: height, height: "100%", borderRadius: height / 2, backgroundColor: usageColor(theme, 100 - remaining) }} />
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

function formatAgo(at: string | null | undefined, now: number) {
  const time = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(time)) return null;
  const minutes = Math.floor((now - time) / MINUTE);
  if (minutes < 1) return "방금 갱신";
  if (minutes < 60) return `${minutes}분 전 갱신`;
  return `${Math.floor(minutes / 60)}시간 전 갱신`;
}

function Cell({ label, usageWindow, theme }: { label: string; usageWindow?: UsageWindow; theme: Theme }) {
  const remaining = remainingOf(usageWindow);
  return (
    <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ fontSize: 11, color: secondaryText(theme) }}>{label}</Text>
      <Bar remaining={remaining} theme={theme} height={4} />
      <Text numberOfLines={1} style={{ width: 40, textAlign: "right", fontSize: 12, fontWeight: "500", color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>
        {formatPercent(remaining)}
      </Text>
    </View>
  );
}

function Row({ name, provider, state, theme }: { name: string; provider?: ProviderUsage; state: AccountState; theme: Theme }) {
  const { fiveHour, weekly } = windowsOf(provider);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 22 }}>
      <Text numberOfLines={1} style={{ width: 54, fontSize: 12, fontWeight: "600", color: theme.colors.foreground }}>{name}</Text>
      {state === "ok" || state === "loading" ? (
        <View style={{ flex: 1, flexDirection: "row", gap: 8 }}>
          <Cell label="5h" usageWindow={fiveHour} theme={theme} />
          <Cell label="1w" usageWindow={weekly} theme={theme} />
        </View>
      ) : (
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: secondaryText(theme) }}>{STATE_SHORT[state]}</Text>
      )}
    </View>
  );
}

function DetailRow({ label, usageWindow, theme, now }: { label: string; usageWindow?: UsageWindow; theme: Theme; now: number }) {
  const remaining = remainingOf(usageWindow);
  const reset = formatReset(usageWindow?.resetsAt, now);
  const rounded = remaining === null ? undefined : Math.round(remaining);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ fontSize: 13, color: theme.colors.foreground }}>{label}</Text>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: secondaryText(theme) }}>{reset ?? ""}</Text>
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>{formatPercent(remaining)}</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel={`${label} 남은 양`}
        accessibilityValue={rounded === undefined ? { text: "조회되지 않음" } : { min: 0, max: 100, now: rounded }}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={rounded}
        aria-valuetext={rounded === undefined ? "조회되지 않음" : `${rounded}% 남음`}
        style={{ flexDirection: "row" }}>
        <Bar remaining={remaining} theme={theme} height={6} />
      </View>
    </View>
  );
}

function Notice({ title, hint, theme, onRetry, busy }: { title: string; hint?: string; theme: Theme; onRetry?(): void; busy?: boolean }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 13, color: theme.colors.foreground }}>{title}</Text>
      {hint && <Text style={{ fontSize: 12, color: secondaryText(theme) }}>{hint}</Text>}
      {onRetry && (
        <Pressable accessibilityRole="button" disabled={busy} onPress={onRetry}
          style={({ hovered }: { hovered?: boolean; pressed: boolean }) => ({
            alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
            borderWidth: 1, borderColor: theme.colors.border,
            backgroundColor: hovered ? theme.colors.surface2 : "transparent", opacity: busy ? 0.5 : 1,
          })}>
          <Text style={{ fontSize: 12, fontWeight: "500", color: theme.colors.foreground }}>{busy ? "다시 불러오는 중…" : "다시 시도"}</Text>
        </Pressable>
      )}
    </View>
  );
}

function AccountDetail({ name, provider, state, theme, now }: { name: string; provider?: ProviderUsage; state: AccountState; theme: Theme; now: number }) {
  const { windows, fiveHour, weekly } = windowsOf(provider);
  if (state === "ok") {
    return (
      <>
        {fiveHour && <DetailRow label="5시간" usageWindow={fiveHour} theme={theme} now={now} />}
        {weekly && <DetailRow label="주간" usageWindow={weekly} theme={theme} now={now} />}
      </>
    );
  }
  if (state === "no_windows") {
    return windows.length > 0
      ? <>{windows.map((usageWindow) => <DetailRow key={usageWindow.id} label={usageWindow.label} usageWindow={usageWindow} theme={theme} now={now} />)}</>
      : <Notice title="조회는 됐지만 표시할 사용량 구간이 없어요." hint="이 요금제는 5시간·주간 한도를 제공하지 않을 수 있어요." theme={theme} />;
  }
  if (state === "error") {
    return <Notice title="사용량 서버에서 오류가 났어요." hint={`${provider?.error ? `${provider.error} · ` : ""}잠시 후 다시 시도해 주세요.`} theme={theme} />;
  }
  if (state === "unavailable") {
    return <Notice title={provider?.error ?? "지금은 사용량을 볼 수 없어요."} hint={`${name} 로그인 상태나 요금제를 확인해 주세요.`} theme={theme} />;
  }
  if (state === "missing") {
    return <Notice title={`이 호스트에서 ${name} 사용량 정보를 받지 못했어요.`} hint={`${name}가 이 호스트에 설정돼 있는지 확인해 주세요.`} theme={theme} />;
  }
  return <Text style={{ fontSize: 13, color: secondaryText(theme) }}>불러오는 중…</Text>;
}

/** Manual refresh with a minimum spin, so even an instant cache hit visibly does something. */
function useManualRefresh(query: UsageQuery) {
  const [spinning, setSpinning] = useState(false);
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current !== null) clearTimeout(timer.current); };
  useEffect(() => clear, []);
  const refresh = async () => {
    if (spinning) return;
    clear();
    setDone(false);
    setSpinning(true);
    const [result] = await Promise.all([query.refetch(), new Promise<void>((resolve) => setTimeout(resolve, SPIN_MS))]);
    setSpinning(false);
    if (result.isError) return;
    setDone(true);
    timer.current = setTimeout(() => setDone(false), DONE_MS);
  };
  return { refresh, spinning, done };
}

function RefreshButton({ theme, spinning, onPress }: { theme: Theme; spinning: boolean; onPress(): void }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) return;
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: SPIN_MS, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => {
      loop.stop();
      // Ease out to the next full turn instead of snapping back.
      turn.stopAnimation((value) => {
        Animated.timing(turn, { toValue: 1, duration: (1 - value) * SPIN_MS * 1.6, easing: Easing.out(Easing.cubic), useNativeDriver: false })
          .start(() => turn.setValue(0));
      });
    };
  }, [spinning, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="새로고침" accessibilityState={{ busy: spinning }} aria-busy={spinning} hitSlop={8}
      disabled={spinning} onPress={onPress}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
        width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center",
        backgroundColor: hovered || pressed ? theme.colors.surface2 : "transparent",
        transform: [{ scale: pressed ? 0.88 : 1 }],
      })}>
      <Animated.Text style={{ fontSize: 15, lineHeight: 17, color: spinning ? theme.colors.foreground : secondaryText(theme), transform: [{ rotate }] }}>↻</Animated.Text>
    </Pressable>
  );
}

function RefreshStatus({ theme, done, updated }: { theme: Theme; done: boolean; updated: string | null }) {
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: done ? 1 : 0, duration: done ? 160 : 320, useNativeDriver: false }).start();
  }, [done, fade]);
  return (
    <View style={{ justifyContent: "center" }}>
      <Animated.View accessibilityLiveRegion="polite" aria-live="polite"
        style={{ position: "absolute", right: 0, flexDirection: "row", alignItems: "center", gap: 4, opacity: fade,
          transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [3, 0] }) }] }}>
        <Text style={{ fontSize: 12, fontWeight: "700", color: theme.colors.statusSuccess }}>✓</Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: theme.colors.foreground }}>{done ? "확인 완료" : ""}</Text>
      </Animated.View>
      <Animated.Text numberOfLines={1} style={{ fontSize: 12, color: secondaryText(theme), opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
        {updated ?? ""}
      </Animated.Text>
    </View>
  );
}

function UsagePopover({ theme, host }: PluginPopoverProps) {
  const query = useUsage(host.id);
  const now = useNow();
  const providers = query.data?.providers ?? [];
  const updated = formatAgo(query.data?.fetchedAt, now);
  const { refresh, spinning, done } = useManualRefresh(query);
  const retry = () => { void refresh(); };
  return (
    <View style={{ minWidth: 280, paddingHorizontal: 4, paddingVertical: 2, gap: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme.colors.foreground }}>사용량</Text>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: secondaryText(theme) }}>{host.label}</Text>
        <RefreshStatus theme={theme} done={done} updated={updated} />
        <RefreshButton theme={theme} spinning={spinning} onPress={retry} />
      </View>
      {query.isError && (
        <View style={{ flexDirection: "row", gap: 10, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
          <View style={{ width: 3, borderRadius: 2, backgroundColor: theme.colors.statusWarning }} />
          <View style={{ flex: 1 }}>
            <Notice theme={theme} onRetry={retry} busy={spinning}
              title={query.data ? "최신 사용량을 불러오지 못했어요." : "사용량을 불러오지 못했어요."}
              hint={query.data ? "아래는 마지막으로 받은 값이에요." : "Paseo 서버 연결을 확인하고 다시 시도해 주세요."} />
          </View>
        </View>
      )}
      {(query.data || query.isPending) && PROVIDERS.map(({ id, name }) => {
        const { accounts, primary } = accountsOf(providers, id);
        const list = accounts.length > 0 ? accounts : [undefined];
        return list.map((provider, index) => {
          const account = list.length > 1 ? provider?.sourceLabel ?? provider?.planLabel ?? `계정 ${index + 1}` : null;
          return (
            <View key={`${id}-${index}`} style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: secondaryText(theme) }}>{name}</Text>
                {account && <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, color: secondaryText(theme) }}>{account}</Text>}
                {list.length > 1 && provider === primary && <Text style={{ fontSize: 11, color: secondaryText(theme) }}>사이드바 표시</Text>}
              </View>
              <AccountDetail name={name} provider={provider} state={stateOf(provider, query)} theme={theme} now={now} />
            </View>
          );
        });
      })}
    </View>
  );
}

export function UsageGraphs({ theme, host, layout, openPopover }: PluginSidebarItemProps) {
  const query = useUsage(host.id);
  const providers = query.data?.providers ?? [];
  const stale = query.isError && Boolean(query.data);
  const rows = PROVIDERS.map(({ id, name }) => {
    const { primary } = accountsOf(providers, id);
    return { id, name, provider: primary, state: stateOf(primary, query) };
  });
  const summary = rows.map(({ name, provider, state }) => {
    if (state !== "ok") return `${name} ${state === "loading" ? "불러오는 중" : STATE_SHORT[state]}`;
    const { fiveHour, weekly } = windowsOf(provider);
    return `${name} 5시간 ${formatPercent(remainingOf(fiveHour))} 남음, 주간 ${formatPercent(remainingOf(weekly))} 남음`;
  }).join(". ");
  return (
    <View style={{ width: "100%", paddingHorizontal: layout.compact ? 4 : 6, paddingVertical: 4 }}>
      <Pressable onPress={() => openPopover(UsagePopover)} accessibilityRole="button"
        accessibilityLabel={`사용량: ${summary}${stale ? ". 갱신 실패, 이전 값" : ""}`}
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
          paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, gap: 2,
          backgroundColor: pressed ? theme.colors.surface2 : hovered ? theme.colors.surface1 : "transparent",
        })}>
        {rows.map(({ id, name, provider, state }) => (
          <Row key={id} name={name} provider={provider} state={state} theme={theme} />
        ))}
        {stale && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 18 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.statusWarning }} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, color: secondaryText(theme) }}>갱신 실패 · 이전 값 표시 중</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
