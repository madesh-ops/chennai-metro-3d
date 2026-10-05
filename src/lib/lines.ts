import routes from "../data/routes.json";

/** Line names and colours (routes.json), for badges on server and client. */
export interface LineInfo {
  id: string;
  name: string;
  colourName: string;
  colour: string;
}

export const LINES: LineInfo[] = (routes as { lines: LineInfo[] }).lines.map((l) => ({ id: l.id, name: l.name, colourName: l.colourName, colour: l.colour }));

const byId = new Map(LINES.map((l) => [l.id, l]));

export function lineInfo(id: string): LineInfo {
  return byId.get(id) ?? { id, name: id, colourName: id, colour: "#888888" };
}

/** Short status for a route (routes.json status). */
export function statusChip(status: string): string {
  if (status === "open") return "Open";
  if (status === "cmrs-approved") return "Opening soon";
  if (status === "under-construction") return "Preview";
  return status;
}
