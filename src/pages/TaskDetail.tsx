import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import {
  STATUS_LABELS,
  type Profile,
  type Task,
  type TaskHistoryEntry,
  type TaskStatus,
} from "../lib/types";

/**
 * Возвращает доступные действия для текущего пользователя и статуса задачи.
 * Ровно та же матрица, что проверяется в БД (RPC task_transition),
 * поэтому UI показывает только реально разрешённые переходы.
 */
function availableActions(
  role: "manager" | "worker" | undefined,
  isAssignee: boolean,
  status: TaskStatus,
) {
  if (!role) return [];
  if (role === "worker" && !isAssignee) return [];
  switch (status) {
    case "new":
    case "rework":
      return role === "worker" && isAssignee
        ? [
            {
              to: "in_progress" as TaskStatus,
              label: "Взять в работу",
              needComment: false,
            },
          ]
        : [];
    case "in_progress":
      return role === "worker" && isAssignee
        ? [
            {
              to: "review" as TaskStatus,
              label: "Отправить на проверку",
              needComment: false,
            },
          ]
        : [];
    case "review":
      return role === "manager"
        ? [
            {
              to: "accepted" as TaskStatus,
              label: "Принять",
              needComment: false,
            },
            {
              to: "rework" as TaskStatus,
              label: "Вернуть на доработку",
              needComment: true,
            },
          ]
        : [];
    default:
      return [];
  }
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { session, profile } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const [workers, setWorkers] = useState<Profile[]>([]);
  const [profileMap, setProfileMap] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const isManager = profile?.role === "manager";
  const isAssignee = task?.assignee_id === session?.user.id;
  const actions = availableActions(
    profile?.role,
    isAssignee,
    task?.status ?? "new",
  );
  const needComment = actions.find((a) => a.needComment) !== undefined;

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: t, error: e1 }, { data: h, error: e2 }, { data: profs }] =
      await Promise.all([
        supabase
          .from("tasks")
          .select("*, projects(name)")
          .eq("id", id)
          .single(),
        supabase
          .from("task_status_history")
          .select("*")
          .eq("task_id", id)
          .order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name, email"),
      ]);
    setProfileMap(
      new Map((profs ?? []).map((pr) => [pr.id, pr.full_name || pr.email])),
    );
    if (e1) setError(e1.message);
    else setTask(t as Task);
    if (e2) setError(e2.message);
    else setHistory((h as TaskHistoryEntry[]) ?? []);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isManager) return;
    supabase
      .from("profiles")
      .select("id, email, full_name, role")
      .eq("role", "worker")
      .then(({ data }) => setWorkers((data as Profile[]) ?? []));
  }, [isManager]);

  const transition = async (to: TaskStatus) => {
    if (!task) return;
    if (to === "rework" && !comment.trim()) {
      setError("Комментарий обязателен при возврате на доработку");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("task_transition", {
      p_task_id: task.id,
      p_to_status: to,
      p_comment: comment.trim() || null,
    });
    setBusy(false);
    if (err) setError(err.message);
    else {
      setComment("");
      void load();
    }
  };

  const updateAssignee = async (assigneeId: string) => {
    if (!task) return;
    const { error: err } = await supabase
      .from("tasks")
      .update({ assignee_id: assigneeId || null })
      .eq("id", task.id);
    if (err) setError(err.message);
    void load();
  };

  if (!task) return <p>{error ?? "Загрузка…"}</p>;

  return (
    <div>
      <Link to={task.project_id ? `/projects/${task.project_id}` : "/"}>
        ← К объекту
      </Link>
      <h1>
        {task.title}{" "}
        <span className={`badge ${task.status}`}>
          {STATUS_LABELS[task.status]}
        </span>
      </h1>

      {error && <p className="error">{error}</p>}

      <div className="card">
        <p>{task.description || <span className="muted">Без описания</span>}</p>
        <p className="muted">
          Объект: {task.projects?.name ?? "—"}
          <br />
          Исполнитель:{" "}
          {task.assignee_id
            ? (profileMap.get(task.assignee_id) ?? "не найден в профилях")
            : "— не назначен —"}
          <br />
          Автор: {profileMap.get(task.author_id) ?? "—"}
          <br />
          Создана: {new Date(task.created_at).toLocaleString("ru-RU")}
        </p>
      </div>

      {isManager && (
        <div className="card">
          <label htmlFor="assignee">
            <strong>Исполнитель</strong>
          </label>
          <select
            id="assignee"
            value={task.assignee_id ?? ""}
            onChange={(e) => void updateAssignee(e.target.value)}
          >
            <option value="">— не назначен —</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name || w.email}
              </option>
            ))}
          </select>
        </div>
      )}

      {actions.length > 0 && (
        <div className="card">
          <h2>Действия</h2>
          <div className="task-actions">
            {actions.map((a) => (
              <button
                key={a.to}
                className={a.to === "accepted" ? "primary" : ""}
                disabled={busy}
                onClick={() => void transition(a.to)}
              >
                {a.label}
              </button>
            ))}
          </div>
          {needComment && (
            <div className="field">
              <label htmlFor="comment">
                Комментарий (обязателен для возврата на доработку)
              </label>
              <textarea
                id="comment"
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>История статусов</h2>
        {history.length === 0 ? (
          <p className="muted">История пуста.</p>
        ) : (
          <ul className="history">
            {history.map((h) => (
              <li key={h.id}>
                {new Date(h.created_at).toLocaleString("ru-RU")}:{" "}
                {STATUS_LABELS[h.from_status]} →{" "}
                <strong>{STATUS_LABELS[h.to_status]}</strong> —{" "}
                {h.changed_by
                  ? (profileMap.get(h.changed_by) ?? "—")
                  : "система"}
                {h.comment && (
                  <div className="muted">Комментарий: {h.comment}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
