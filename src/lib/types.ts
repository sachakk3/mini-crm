export type UserRole = "manager" | "worker";

export type TaskStatus =
  | "new"
  | "in_progress"
  | "review"
  | "accepted"
  | "rework";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
}

export interface Project {
  id: string;
  name: string;
  address: string;
  created_by: string;
  created_at: string;
}

export interface ProfileShort {
  full_name: string;
  email: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  project_id: string;
  assignee_id: string | null;
  status: TaskStatus;
  author_id: string;
  created_at: string;
  // Джойны (алиасы в select)
  projects?: { name: string };
  assignee?: ProfileShort | null;
  author?: ProfileShort | null;
}

export interface TaskHistoryEntry {
  id: string;
  task_id: string;
  changed_by: string | null;
  from_status: TaskStatus;
  to_status: TaskStatus;
  comment: string | null;
  created_at: string;
  profiles?: ProfileShort | null;
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  review: "На проверке",
  accepted: "Принята",
  rework: "На доработке",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  manager: "Постановщик",
  worker: "Исполнитель",
};
