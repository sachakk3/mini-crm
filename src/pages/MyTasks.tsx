import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { STATUS_LABELS, type Task } from "../lib/types";

export default function MyTasks() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    setLoading(true);
    // RLS вернёт только задачи назначенного исполнителя
    const { data, error: err } = await supabase
      .from("tasks")
      .select(
        "*, projects(name), assignee:profiles!assignee_id(full_name, email)",
      )
      .eq("assignee_id", session.user.id)
      .order("created_at", { ascending: false });
    if (err) setError(err.message);
    else {
      setTasks((data as Task[]) ?? []);
      setError(null);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1>Мои задачи</h1>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Загрузка…</p>}
      {!loading && tasks.length === 0 && (
        <p className="muted">У вас пока нет задач.</p>
      )}
      {tasks.map((t) => (
        <div
          key={t.id}
          className="card clickable"
          onClick={() => navigate(`/tasks/${t.id}`)}
        >
          <strong>{t.title}</strong>{" "}
          <span className={`badge ${t.status}`}>{STATUS_LABELS[t.status]}</span>
          <div className="muted">Объект: {t.projects?.name ?? "—"}</div>
        </div>
      ))}
    </div>
  );
}
