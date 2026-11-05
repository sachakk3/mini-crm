import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import {
  STATUS_LABELS,
  type Profile,
  type Project,
  type Task,
} from "../lib/types";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workers, setWorkers] = useState<Profile[]>([]);
  const [profileMap, setProfileMap] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Форма создания/редактирования задачи (только постановщик)
  const [editing, setEditing] = useState<Task | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  const isManager = profile?.role === "manager";

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: p, error: e1 }, { data: t, error: e2 }, { data: profs }] =
      await Promise.all([
        supabase.from("projects").select("*").eq("id", id).single(),
        supabase
          .from("tasks")
          .select("*")
          .eq("project_id", id)
          .order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name, email"),
      ]);
    setProfileMap(
      new Map((profs ?? []).map((pr) => [pr.id, pr.full_name || pr.email])),
    );
    if (e1) setError(e1.message);
    else setProject(p as Project);
    if (e2) setError(e2.message);
    else setTasks((t as Task[]) ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Список исполнителей для назначения (только постановщик)
  useEffect(() => {
    if (!isManager) return;
    supabase
      .from("profiles")
      .select("id, email, full_name, role")
      .eq("role", "worker")
      .then(({ data }) => setWorkers((data as Profile[]) ?? []));
  }, [isManager]);

  const startCreate = () => {
    setEditing(null);
    setTitle("");
    setDescription("");
    setAssigneeId("");
  };

  const startEdit = (t: Task) => {
    setEditing(t);
    setTitle(t.title);
    setDescription(t.description);
    setAssigneeId(t.assignee_id ?? "");
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (editing) {
      const { error: err } = await supabase
        .from("tasks")
        .update({ title, description, assignee_id: assigneeId || null })
        .eq("id", editing.id);
      if (err) {
        setError(err.message);
        return;
      }
    } else {
      const { error: err } = await supabase.from("tasks").insert({
        title,
        description,
        project_id: id,
        assignee_id: assigneeId || null,
        author_id: profile!.id,
      });
      if (err) {
        setError(err.message);
        return;
      }
    }
    startCreate();
    void load();
  };

  const onDelete = async (t: Task) => {
    if (!confirm(`Удалить задачу «${t.title}»?`)) return;
    const { error: err } = await supabase.from("tasks").delete().eq("id", t.id);
    if (err) setError(err.message);
    void load();
  };

  if (loading) return <p className="muted">Загрузка…</p>;
  if (!project)
    return (
      <p>
        Объект не найден или нет доступа. <Link to="/">Назад</Link>
      </p>
    );

  return (
    <div>
      <Link to="/">← Все объекты</Link>
      <h1>{project.name}</h1>
      <p className="muted">{project.address}</p>

      {error && <p className="error">{error}</p>}

      <h2>Задачи ({tasks.length})</h2>

      {isManager && (
        <div className="card">
          <h2>{editing ? "Редактирование задачи" : "Новая задача"}</h2>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="t-title">Название</label>
              <input
                id="t-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="t-desc">Описание</label>
              <textarea
                id="t-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="t-assignee">Исполнитель</label>
              <select
                id="t-assignee"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">— не назначен —</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.full_name || w.email}
                  </option>
                ))}
              </select>
            </div>
            <button className="primary" type="submit">
              {editing ? "Сохранить" : "Создать задачу"}
            </button>
            {editing && (
              <button type="button" onClick={startCreate}>
                Отмена
              </button>
            )}
          </form>
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <p className="muted">Задач пока нет.</p>
      )}

      {tasks.map((t) => (
        <div
          key={t.id}
          className="card clickable"
          onClick={() => navigate(`/tasks/${t.id}`)}
        >
          <strong>{t.title}</strong>{" "}
          <span className={`badge ${t.status}`}>{STATUS_LABELS[t.status]}</span>
          <div className="muted">
            Исполнитель:{" "}
            {t.assignee_id
              ? (profileMap.get(t.assignee_id) ?? "не найден в профилях")
              : "— не назначен —"}
          </div>
          {isManager && (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(t);
                }}
              >
                Редактировать
              </button>
              <button
                className="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  void onDelete(t);
                }}
              >
                Удалить
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
