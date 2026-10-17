// Shapes shared by CollabProvider and its consumers: presence users,
// message annotations, team-task progress frames, floor (speaker) state,
// and the context value the provider exposes. collab-provider.tsx
// re-exports the public ones.

import type { SpeakerPolicy } from "@/core/teams";
import type { TeamTask } from "@/core/team-tasks/types";
import type {
  CoworkMessageReaction,
  CoworkPinnedMessage,
  CoworkRoomReplyReference,
} from "@/core/cowork/types";

import type { RoomMessage, RoomMessageReceipt } from "./room-message-state";

export interface User {
  id: string;
  name: string;
  avatar?: string;
  color: string;
}

export interface AnnotationAuthor {
  display_name: string;
  avatar_color: string;
}

export interface AnnotationReply {
  reply_id: string;
  author: AnnotationAuthor | null;
  body: string;
  created_at: number;
}

export interface Annotation {
  annotation_id: string;
  message_id: string;
  author: AnnotationAuthor | null;
  body: string;
  created_at: number;
  resolved: boolean;
  replies: AnnotationReply[];
}

export interface TeamTaskProgressEvent {
  id: string;
  team_id: string;
  room_id: string;
  task_id: string;
  task: TeamTask | null;
  event: string;
  role?: string | null;
  role_status?: string | null;
  completed_roles?: number;
  total_roles?: number;
  progress?: number;
  server_time: string;
  error?: string | null;
  runner_event?: Record<string, unknown> | null;
}

export interface FloorState {
  speakerPolicy: SpeakerPolicy;
  currentSpeakerId: string | null;
  moderatorId: string | null;
  floorRequests: string[];
}

export interface CollabContextType {
  canWrite: boolean;
  users: User[];
  currentUser: User | null;
  isConnected: boolean;
  roomMessages: RoomMessage[];
  messageReceipts: RoomMessageReceipt[];
  taskEvents: TeamTaskProgressEvent[];
  floor: FloorState;
  join: (user: User) => void;
  leave: () => void;
  updateCursor: (position: { x: number; y: number }) => void;
  sendRoomMessage: (
    text: string,
    onBehalfOf?: string,
    replyTo?: CoworkRoomReplyReference | null,
  ) => string | null;
  retryRoomMessage: (messageId: string) => boolean;
  markRoomMessageRead: (messageId: string, seq?: number) => boolean;
  raiseHand: () => void;
  yieldFloor: () => void;
  grantFloor: (targetId: string | null) => void;
  notifyThreadUpdate: (reason?: string) => void;
  annotations: Annotation[];
  messageReactions: CoworkMessageReaction[];
  pinnedMessages: CoworkPinnedMessage[];
  toggleMessageReaction: (messageId: string, emoji: string) => Promise<void>;
  togglePinnedMessage: (messageId: string) => Promise<void>;
  addAnnotation: (messageId: string, body: string) => Promise<void>;
  resolveAnnotation: (annotationId: string) => Promise<void>;
  unresolveAnnotation: (annotationId: string) => Promise<void>;
  deleteAnnotation: (annotationId: string) => Promise<void>;
  replyToAnnotation: (annotationId: string, body: string) => Promise<void>;
}
