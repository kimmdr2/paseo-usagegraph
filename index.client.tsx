import type { PluginClientContext } from "@getpaseo/plugin/client";
import { UsageGraphs } from "./client/usage-graphs";

export default function contribute(client: PluginClientContext) {
  return client.addSidebarFooterItem({
    id: "quota-graphs",
    title: "사용량 그래프",
    Component: UsageGraphs,
  });
}
