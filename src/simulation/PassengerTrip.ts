/**
 * The passenger's own journey in Walk mode, as a small state machine:
 *
 *   buy a ticket → put the bag on the X-ray belt → body scan → collect the bag →
 *   scan in at the gate → reach the platform → board → ride → alight →
 *   scan out → drop the used ticket → leave the station.
 *
 * It knows nothing about 3D or input. The walk controller reports what the
 * passenger did (bought, scanned, stepped aboard…) and reads back the stage
 * and what to do next. Stations whose inside is not modelled are skipped:
 * the trip then begins or ends on board the train.
 */

export type TripStage =
  | "buy-ticket"
  | "drop-bag"
  | "security"
  | "collect-bag"
  | "enter-gate"
  | "to-platform"
  | "board"
  | "riding"
  | "alight"
  | "exit-gate"
  | "drop-ticket"
  | "leave-station"
  | "done";

/** Where the passenger should head next (the scene puts a marker there). */
export type TripTarget = "counter" | "bag-drop" | "security" | "bag-collect" | "entry-gate" | "platform" | "train" | "none" | "exit-gate" | "ticket-box" | "street";

export interface TripOptions {
  /** The origin station can be walked through (concourse, gates, platform). */
  originWalkable: boolean;
  destinationWalkable: boolean;
  /** Walk mode began with the ride already under way: start on board, ticket in hand. */
  rideStarted?: boolean;
}

export type ScanResult = "ok" | "no-ticket" | "not-cleared" | "already-scanned" | "not-here";

const ORDER: TripStage[] = ["buy-ticket", "drop-bag", "security", "collect-bag", "enter-gate", "to-platform", "board", "riding", "alight", "exit-gate", "drop-ticket", "leave-station", "done"];

export class PassengerTrip {
  stage: TripStage;
  hasTicket: boolean;
  /** The used ticket went into the box at the exit (false if the passenger walked off with it). */
  ticketDropped = false;
  /** The trip began on board (origin not walkable, or joined mid-ride). */
  readonly startedAboard: boolean;
  private readonly destinationWalkable: boolean;

  constructor(opts: TripOptions) {
    this.startedAboard = !opts.originWalkable || Boolean(opts.rideStarted);
    this.destinationWalkable = opts.destinationWalkable;
    this.stage = this.startedAboard ? "riding" : "buy-ticket";
    this.hasTicket = this.startedAboard;
  }

  /** True once `stage` is at or past `other`. */
  reached(other: TripStage): boolean {
    return ORDER.indexOf(this.stage) >= ORDER.indexOf(other);
  }

  get aboard(): boolean {
    return this.stage === "riding" || this.stage === "alight";
  }

  /** The train must wait at the origin platform: the passenger has not boarded yet. */
  get holdsTrain(): boolean {
    return !this.reached("riding");
  }

  /** Entry gates let the passenger through only with a ticket they have not used yet. */
  get mayEnter(): boolean {
    return this.stage === "enter-gate";
  }

  get mayExit(): boolean {
    return this.stage === "exit-gate";
  }

  buyTicket(): boolean {
    if (this.stage !== "buy-ticket") return false;
    this.hasTicket = true;
    this.stage = "drop-bag";
    return true;
  }

  /** The bag is on the X-ray belt. */
  dropBag(): boolean {
    if (this.stage !== "drop-bag") return false;
    this.stage = "security";
    return true;
  }

  /** The guard has finished the body scan: the way to the bag and the gates opens. */
  clearSecurity(): boolean {
    if (this.stage !== "security") return false;
    this.stage = "collect-bag";
    return true;
  }

  /** The bag is back in hand, at the far end of the belt. */
  collectBag(): boolean {
    if (this.stage !== "collect-bag") return false;
    this.stage = "enter-gate";
    return true;
  }

  scanEntry(): ScanResult {
    if (this.stage === "buy-ticket") return "no-ticket";
    if (this.stage === "drop-bag" || this.stage === "security" || this.stage === "collect-bag") return "not-cleared";
    if (this.stage !== "enter-gate") return this.reached("alight") ? "not-here" : "already-scanned";
    this.stage = "to-platform";
    return "ok";
  }

  reachPlatform() {
    if (this.stage === "to-platform") this.stage = "board";
  }

  /** Stepped through the train doors at the origin. */
  board(): boolean {
    if (this.stage !== "to-platform" && this.stage !== "board") return false;
    this.stage = "riding";
    return true;
  }

  /** The train has stopped at the destination with its doors open. */
  arrive() {
    if (this.stage !== "riding") return;
    this.stage = this.destinationWalkable ? "alight" : "done";
  }

  /** The train pulled away again before the passenger got off (the timeline was moved back). */
  rideOn() {
    if (this.stage === "alight") this.stage = "riding";
  }

  /** Stepped out onto the destination platform. */
  alight(): boolean {
    if (this.stage !== "alight") return false;
    this.stage = "exit-gate";
    return true;
  }

  scanExit(): ScanResult {
    if (!this.reached("exit-gate")) return "not-here";
    if (this.stage !== "exit-gate") return "already-scanned";
    if (!this.hasTicket) return "no-ticket";
    this.stage = "drop-ticket";
    return "ok";
  }

  dropTicket(): boolean {
    if (this.stage !== "drop-ticket") return false;
    this.hasTicket = false;
    this.ticketDropped = true;
    this.stage = "leave-station";
    return true;
  }

  /** Back on the street outside the destination: the journey is over, with or without the ticket. */
  reachStreet() {
    if (this.stage === "drop-ticket" || this.stage === "leave-station") this.stage = "done";
  }

  get target(): TripTarget {
    switch (this.stage) {
      case "buy-ticket":
        return "counter";
      case "drop-bag":
        return "bag-drop";
      case "security":
        return "security";
      case "collect-bag":
        return "bag-collect";
      case "enter-gate":
        return "entry-gate";
      case "to-platform":
        return "platform";
      case "board":
        return "train";
      case "exit-gate":
        return "exit-gate";
      case "drop-ticket":
        return "ticket-box";
      case "leave-station":
        return "street";
      default:
        return "none";
    }
  }
}

/** One line telling the passenger what to do now. */
export function tripObjective(stage: TripStage, names: { from: string; to: string }): string {
  switch (stage) {
    case "buy-ticket":
      return `Buy a ticket to ${names.to} at the counter`;
    case "drop-bag":
      return "Put your bag on the X-ray belt";
    case "security":
      return "Go through a security lane: men's or women's";
    case "collect-bag":
      return "Collect your bag at the end of the belt";
    case "enter-gate":
      return "Scan your ticket at an entry gate";
    case "to-platform":
      return "Take the escalator up to the platform";
    case "board":
      return `Board the train to ${names.to}`;
    case "riding":
      return `On board. Get off at ${names.to}`;
    case "alight":
      return `This is ${names.to}. Step off the train`;
    case "exit-gate":
      return "Take the escalator down and scan out at an exit gate";
    case "drop-ticket":
      return "Drop your used ticket in the box";
    case "leave-station":
      return "Take the stairs down to the street";
    case "done":
      return "Journey complete";
  }
}
