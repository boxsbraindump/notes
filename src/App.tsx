import { type DragEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Cursor, Input, Modal, Time, Typewriter } from 'animal-island-ui';

type Project = {
  id: string;
  name: string;
  description: string;
  color: 'app-teal' | 'app-yellow' | 'app-pink' | 'app-blue';
  updatedAt: string;
};

type Task = {
  id: string;
  projectId: string;
  title: string;
  done: boolean;
  followUp?: boolean;
  followUpHint?: string;
  sourceNoteId?: string;
  createdAt: string;
  completedAt?: string;
};

type Note = {
  id: string;
  projectId: string;
  rawText: string;
  extractedTaskIds: string[];
  createdAt: string;
};

type CandidateTask = {
  title: string;
  followUp: boolean;
  followUpHint?: string;
};

type TreeReward = {
  projectId: string;
  water: number;
  lastWateredAt?: string;
};

const starterProjects: Project[] = [
  {
    id: 'memo',
    name: '动物岛备忘录',
    description: '先把小岛搭起来，再慢慢让它会整理想法。',
    color: 'app-teal',
    updatedAt: '刚刚',
  },
  {
    id: 'brain-dump',
    name: '胡言乱语收纳箱',
    description: '所有跳出来的念头都可以先丢到这里。',
    color: 'app-yellow',
    updatedAt: '今天',
  },
];

const starterTasks: Task[] = [
  {
    id: 'task-home',
    projectId: 'memo',
    title: '确认首页和项目卡片的感觉',
    done: false,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'task-brain-dump',
    projectId: 'memo',
    title: '做乱写内容整理成待办',
    done: false,
    followUp: true,
    followUpHint: '每天晨间小结提醒',
    createdAt: new Date().toISOString(),
  },
];

const colorCycle: Project['color'][] = ['app-teal', 'app-yellow', 'app-pink', 'app-blue'];
const projectStorageKey = 'adhd-animal-island-v4-projects';
const taskStorageKey = 'adhd-animal-island-v4-tasks';
const noteStorageKey = 'adhd-animal-island-v4-notes';
const treeStorageKey = 'adhd-animal-island-v1-trees';

const loadList = <T,>(key: string, fallback: T[]) => {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const isLegacyBadTask = (task: Task) =>
  task.title === '做乱来' || task.title.startsWith('做去超市买一个苹果');

const tidyTaskTitle = (text: string) =>
  text
    .replace(/^[啊嗯额呃呀\s]+/g, '')
    .replace(/^(我|可能|会|可以|应该|需要|要|先|再|把|这个项目|今天|去|到)+/g, '')
    .replace(/(了|一下|吧|吗|呢|先)$/g, '')
    .trim();

const splitShoppingItems = (text: string) => {
  const quantityPattern = /(?:\d+|一|两|二|三|四|五|六|七|八|九|十)(?:个|颗|根|盒|瓶|袋|罐|包|斤|份|只|张|本|条|块)/g;
  return text
    .replace(quantityPattern, '|')
    .split(/(?:\||和|跟|以及|还有|、|，|,)+/)
    .map((item) =>
      item
        .replace(/^(买|拿|带|一点|一些|几个|几份)+/g, '')
        .replace(/(回来|回家|备用|用)$/g, '')
        .trim()
    )
    .filter((item) => item.length > 0);
};

const getFollowUpHint = (text: string) => {
  if (/明天/.test(text)) return '明天 follow up';
  if (/后天/.test(text)) return '后天 follow up';
  if (/下周|下星期/.test(text)) return '下周 follow up';
  if (/过几天|几天后|之后|晚点|回头/.test(text)) return '过几天 follow up';
  if (/等.*回复|等.*回信|回复/.test(text)) return '等回复后 follow up';
  if (/follow\s*up|跟进|追踪|回访/.test(text)) return '需要 follow up';
  if (/账单|打电话|电话|客服|报销|保险|银行/.test(text)) return '杂事务 follow up';
  return undefined;
};

const extractTasksFromIdea = (rawText: string) => {
  const normalizedText = rawText.replace(/\s+/g, ' ');
  const pieces = normalizedText
    .replace(/\s+/g, ' ')
    .split(/(?:然后|接着|之后|过一会|另外|还有|，|。|！|？|,|;|；|\n)+/)
    .map((piece) => piece.trim())
    .filter(Boolean);

  const results: CandidateTask[] = [];
  const addTask = (value: string, sourceText = value) => {
    const cleaned = tidyTaskTitle(value);
    if (!cleaned) return;
    const title = /^(做|买|写|整理|处理|完成|修|改|联系|发送|查看|看|打电话|跟进|follow up|预约|准备|更新)/.test(cleaned)
      ? cleaned
      : `做${cleaned}`;
    if (results.some((task) => task.title === title)) return;
    const followUpHint = getFollowUpHint(sourceText);
    results.push({ title, followUp: Boolean(followUpHint), followUpHint });
  };

  pieces.forEach((piece) => {
    if (/乱来|胡言乱语|好复杂|不知道|随便/.test(piece)) return;

    const handleMatch = piece.match(/处理(.+?)(?:打电话|电话|$)/);
    if (handleMatch?.[1]) {
      addTask(`处理${handleMatch[1]}`, piece);
    }

    if (/打电话|电话/.test(piece) && !/等.*电话/.test(piece)) {
      addTask('打电话', piece);
    }

    const buyMatch = piece.match(/买(.+)$/);
    if (buyMatch?.[1]) {
      splitShoppingItems(buyMatch[1]).forEach((item) => addTask(`买${item}`, piece));
      return;
    }

    const withObject = piece.match(/(?:需要|应该|要|知道).*?(?:先把|把)(.+?)(?:做了|做完|完成|搞定)?$/);
    if (withObject?.[1]) {
      addTask(withObject[1], piece);
      return;
    }

    const putObject = piece.match(/(?:先把|把)(.+?)(?:做了|做完|完成|搞定)?$/);
    if (putObject?.[1]) {
      addTask(putObject[1], piece);
      return;
    }

    const directDo = piece.match(/(?:先做|再做|做)(.+)$/);
    if (directDo?.[1]) {
      addTask(directDo[1], piece);
      return;
    }

    const needAction = piece.match(/(?:需要|应该|要)(.+)$/);
    if (needAction?.[1] && /做|写|整理|处理|完成|修|改|联系|发|看|买|打电话|电话|跟进|follow\s*up|预约|准备|更新/.test(needAction[1])) {
      addTask(needAction[1], piece);
    }
  });

  return results.slice(0, 5);
};

const isSameDay = (dateValue: string | undefined, target: Date) => {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  return (
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
};

const buildMorningSummary = (project: Project, projectTasks: Task[], projectNotes: Note[]) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const openTasks = projectTasks.filter((task) => !task.done);
  const followUps = openTasks.filter((task) => task.followUp);
  const completedYesterday = projectTasks.filter((task) => task.done && isSameDay(task.completedAt, yesterday));
  const notesYesterday = projectNotes.filter((note) => isSameDay(note.createdAt, yesterday));

  if (openTasks.length === 0 && notesYesterday.length === 0 && completedYesterday.length === 0) {
    return `早上好。昨天「${project.name}」没有留下未完成事项。今天如果有新的杂念，先丢进碎碎念里，我们再慢慢整理。`;
  }

  const parts = [`早上好，这是「${project.name}」的小小晨间复盘。`];

  if (notesYesterday.length > 0) {
    parts.push(`昨天你收纳了 ${notesYesterday.length} 条想法，我已经帮你留在这里。`);
  }

  if (completedYesterday.length > 0) {
    parts.push(`昨天完成了 ${completedYesterday.length} 件事，可以安心划掉。`);
  }

  if (followUps.length > 0) {
    parts.push(
      `今天最需要记得 follow up：${followUps
        .slice(0, 3)
        .map((task) => task.title)
        .join('、')}。`
    );
  }

  if (openTasks.length > 0) {
    parts.push(`还没办完的事情有 ${openTasks.length} 件。我们不用一次记住全部，先从第一件开始：${openTasks[0].title}。`);
  }

  return parts.join('');
};

const getTreeStage = (water: number) => {
  if (water >= 8) return 4;
  if (water >= 5) return 3;
  if (water >= 2) return 2;
  if (water >= 1) return 1;
  return 0;
};

const getTreeMessage = (stage: number) => {
  if (stage === 0) return '完成一个待办，就给小树浇一次水。';
  if (stage === 1) return '发芽了。今天已经有一点点推进。';
  if (stage === 2) return '小树长高了一截，继续慢慢来。';
  if (stage === 3) return '树冠变丰满了，这个项目正在长起来。';
  return '这棵树已经很茂盛了。辛苦有留下痕迹。';
};

export default function App() {
  const [projects, setProjects] = useState<Project[]>(() =>
    loadList(projectStorageKey, starterProjects)
  );
  const [tasks, setTasks] = useState<Task[]>(() =>
    loadList(taskStorageKey, starterTasks).filter((task) => !isLegacyBadTask(task))
  );
  const [trees, setTrees] = useState<TreeReward[]>(() => loadList<TreeReward>(treeStorageKey, []));
  const [notes, setNotes] = useState<Note[]>(() =>
    loadList<Note>(noteStorageKey, []).filter(
      (note) => !/去超市买.*苹果.*番茄罐头/.test(note.rawText)
    )
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [ideaText, setIdeaText] = useState('');
  const [candidateTasks, setCandidateTasks] = useState<CandidateTask[]>([]);
  const [organizeMessage, setOrganizeMessage] = useState('');
  const [manualTaskText, setManualTaskText] = useState('');
  const [armedProjectId, setArmedProjectId] = useState<string | null>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const projectPressTimerRef = useRef<number | null>(null);

  const totalOpenTasks = useMemo(
    () => tasks.filter((task) => !task.done).length,
    [tasks]
  );
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const selectedProjectTasks = useMemo(
    () => tasks.filter((task) => task.projectId === selectedProjectId),
    [selectedProjectId, tasks]
  );
  const selectedProjectNotes = useMemo(
    () => notes.filter((note) => note.projectId === selectedProjectId).slice(-3).reverse(),
    [notes, selectedProjectId]
  );

  useEffect(() => {
    localStorage.setItem(projectStorageKey, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem(taskStorageKey, JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem(noteStorageKey, JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    localStorage.setItem(treeStorageKey, JSON.stringify(trees));
  }, [trees]);

  const openTaskCount = (projectId: string) =>
    tasks.filter((task) => task.projectId === projectId && !task.done).length;

  const clearProjectPressTimer = () => {
    if (projectPressTimerRef.current) {
      window.clearTimeout(projectPressTimerRef.current);
      projectPressTimerRef.current = null;
    }
  };

  const handleProjectPressStart = (event: PointerEvent<HTMLElement>, projectId: string) => {
    if ((event.target as HTMLElement).closest('button')) return;
    clearProjectPressTimer();
    projectPressTimerRef.current = window.setTimeout(() => {
      setArmedProjectId(projectId);
    }, 420);
  };

  const handleProjectDragStart = (event: DragEvent, projectId: string) => {
    if (armedProjectId !== projectId) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData('text/plain', projectId);
    event.dataTransfer.effectAllowed = 'move';
    setDraggedProjectId(projectId);
  };

  const moveProjectBefore = (dragProjectId: string, targetProjectId: string) => {
    if (dragProjectId === targetProjectId) return;
    setProjects((current) => {
      const moving = current.find((project) => project.id === dragProjectId);
      if (!moving) return current;
      const withoutMoving = current.filter((project) => project.id !== dragProjectId);
      const targetIndex = withoutMoving.findIndex((project) => project.id === targetProjectId);
      if (targetIndex < 0) return current;
      return [
        ...withoutMoving.slice(0, targetIndex),
        moving,
        ...withoutMoving.slice(targetIndex),
      ];
    });
  };

  const deleteProject = (projectId: string) => {
    setProjects((current) => current.filter((project) => project.id !== projectId));
    setTasks((current) => current.filter((task) => task.projectId !== projectId));
    setNotes((current) => current.filter((note) => note.projectId !== projectId));
    setTrees((current) => current.filter((tree) => tree.projectId !== projectId));
    if (selectedProjectId === projectId) setSelectedProjectId(null);
  };

  const finishProjectDrag = () => {
    clearProjectPressTimer();
    setDraggedProjectId(null);
    setArmedProjectId(null);
  };

  const resetCreateForm = () => {
    setProjectName('');
    setProjectDescription('');
  };

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    resetCreateForm();
  };

  const createProject = () => {
    const trimmedName = projectName.trim();
    if (!trimmedName) return;

    const nextProject: Project = {
      id: crypto.randomUUID(),
      name: trimmedName,
      description: projectDescription.trim() || '这座小岛还在长出自己的形状。',
      color: colorCycle[projects.length % colorCycle.length],
      updatedAt: '刚刚',
    };

    setProjects((current) => [nextProject, ...current]);
    setSelectedProjectId(nextProject.id);
    closeCreateModal();
  };

  const organizeIdea = () => {
    const extracted = extractTasksFromIdea(ideaText);
    setCandidateTasks(extracted);
    setOrganizeMessage(
      extracted.length > 0
        ? `抓到 ${extracted.length} 个可以做的小任务。`
        : '这段还太像云雾了，再写具体一点点我会更好抓。'
    );
  };

  const addCandidateTasks = () => {
    if (!selectedProject || candidateTasks.length === 0) return;

    const noteId = crypto.randomUUID();
    const now = new Date().toISOString();
    const createdTasks = candidateTasks.map<Task>((candidate) => ({
      id: crypto.randomUUID(),
      projectId: selectedProject.id,
      title: candidate.title,
      done: false,
      followUp: false,
      followUpHint: undefined,
      sourceNoteId: noteId,
      createdAt: now,
    }));

    setTasks((current) => [...createdTasks, ...current]);
    setNotes((current) => [
      {
        id: noteId,
        projectId: selectedProject.id,
        rawText: ideaText.trim(),
        extractedTaskIds: createdTasks.map((task) => task.id),
        createdAt: now,
      },
      ...current,
    ]);
    setProjects((current) =>
      current.map((project) =>
        project.id === selectedProject.id ? { ...project, updatedAt: '刚刚' } : project
      )
    );
    setIdeaText('');
    setCandidateTasks([]);
    setOrganizeMessage('已经放进待办篮子了。');
  };

  const addManualTask = () => {
    if (!selectedProject) return;
    const title = manualTaskText.trim();
    if (!title) return;

    const now = new Date().toISOString();
    setTasks((current) => [
      {
        id: crypto.randomUUID(),
        projectId: selectedProject.id,
        title,
        done: false,
        createdAt: now,
      },
      ...current,
    ]);
    setProjects((current) =>
      current.map((project) =>
        project.id === selectedProject.id ? { ...project, updatedAt: '刚刚' } : project
      )
    );
    setManualTaskText('');
  };

  const waterProjectTree = (projectId: string) => {
    const now = new Date().toISOString();
    setTrees((current) => {
      const existing = current.find((tree) => tree.projectId === projectId);
      if (!existing) return [...current, { projectId, water: 1, lastWateredAt: now }];
      return current.map((tree) =>
        tree.projectId === projectId
          ? { ...tree, water: tree.water + 1, lastWateredAt: now }
          : tree
      );
    });
  };

  const toggleTask = (taskId: string) => {
    const now = new Date().toISOString();
    const targetTask = tasks.find((task) => task.id === taskId);
    if (targetTask && !targetTask.done) {
      waterProjectTree(targetTask.projectId);
    }
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              done: !task.done,
              completedAt: task.done ? undefined : now,
            }
          : task
      )
    );
  };

  const deleteTask = (taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    setNotes((current) =>
      current.map((note) => ({
        ...note,
        extractedTaskIds: note.extractedTaskIds.filter((id) => id !== taskId),
      }))
    );
  };

  const moveTaskToFollowUp = (taskId: string, followUp: boolean) => {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              followUp,
              followUpHint: followUp ? task.followUpHint ?? '需要 follow up' : undefined,
            }
          : task
      )
    );
  };

  const handleDragStart = (event: DragEvent, taskId: string) => {
    event.dataTransfer.setData('text/plain', taskId);
  };

  const handleDrop = (event: DragEvent, followUp: boolean) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData('text/plain');
    if (taskId) moveTaskToFollowUp(taskId, followUp);
  };

  if (selectedProject) {
    const selectedOpenTasks = selectedProjectTasks.filter((task) => !task.done).length;
    const selectedDoneTasks = selectedProjectTasks.filter((task) => task.done).length;
    const normalTasks = selectedProjectTasks.filter((task) => !task.followUp);
    const followUpTasks = selectedProjectTasks.filter((task) => task.followUp);
    const morningSummary = buildMorningSummary(selectedProject, selectedProjectTasks, selectedProjectNotes);

    return (
      <Cursor>
      <main className="app-shell detail-shell">
        <section className="detail-topbar">
          <Button type="default" onClick={() => setSelectedProjectId(null)}>
            回到小岛列表
          </Button>
          <Button type="primary" onClick={() => setIsCreateOpen(true)}>
            开新岛
          </Button>
        </section>

        <Card color={selectedProject.color} className="detail-hero">
          <span className="project-pill">{selectedProject.updatedAt}</span>
          <h1>{selectedProject.name}</h1>
          <p>{selectedProject.description}</p>
        </Card>

        <section className="detail-grid">
          <Card className="detail-panel">
            <h2>待办篮子</h2>
            <p className="quiet-text">
              拖到旁边的 Follow up 篮子，就会每天早上提醒你。
            </p>
            {candidateTasks.length > 0 && (
              <div className="candidate-box">
                <span>刚刚抓到：</span>
                {candidateTasks.map((task) => (
                  <div className="candidate-item" key={task.title}>
                    <p>{task.title}</p>
                    <button
                      type="button"
                      aria-label={`移除 ${task.title}`}
                      onClick={() =>
                        setCandidateTasks((current) =>
                          current.filter((item) => item.title !== task.title)
                        )
                      }
                    >
                      删除
                    </button>
                  </div>
                ))}
                <Button type="primary" size="small" onClick={addCandidateTasks}>
                  加入待办
                </Button>
              </div>
            )}
            <div className="manual-task-row">
              <Input
                size="middle"
                shadow
                value={manualTaskText}
                placeholder="直接写一个待办"
                onChange={(event) => setManualTaskText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addManualTask();
                }}
              />
              <Button type="primary" size="small" onClick={addManualTask} disabled={!manualTaskText.trim()}>
                加进去
              </Button>
            </div>
            <div
              className="todo-list drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, false)}
            >
              {normalTasks.length === 0 ? (
                <p className="empty-drop-text">这里还没有待办。先把脑子里的东西倒出来也可以。</p>
              ) : (
                normalTasks.map((task) => (
                  <label
                    key={task.id}
                    className="todo-item"
                    draggable
                    onDragStart={(event) => handleDragStart(event, task.id)}
                  >
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={() => toggleTask(task.id)}
                    />
                    <span>{task.title}</span>
                    <button type="button" onClick={() => deleteTask(task.id)}>
                      删除
                    </button>
                  </label>
                ))
              )}
            </div>
          </Card>

          <Card className="detail-panel follow-panel">
            <h2>Follow up 篮子</h2>
            <p className="quiet-text">需要过几天再看一眼的事，拖到这里。</p>
            <div
              className="todo-list drop-zone follow-drop"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, true)}
            >
              {followUpTasks.length === 0 ? (
                <p className="empty-drop-text">暂时没有需要跟进的事。</p>
              ) : (
                followUpTasks.map((task) => (
                  <label
                    key={task.id}
                    className="todo-item follow-item"
                    draggable
                    onDragStart={(event) => handleDragStart(event, task.id)}
                  >
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={() => toggleTask(task.id)}
                    />
                    <span>{task.title}</span>
                    <button type="button" onClick={() => deleteTask(task.id)}>
                      删除
                    </button>
                  </label>
                ))
              )}
            </div>
          </Card>

          <Card className="detail-panel idea-panel">
            <h2>脑内碎碎念</h2>
            <textarea
              className="idea-box"
              placeholder="乱写也可以。比如：我需要先做 a，然后可能再做 b。"
              value={ideaText}
              onChange={(event) => {
                setIdeaText(event.target.value);
                setCandidateTasks([]);
                setOrganizeMessage('');
              }}
            />
            <div className="idea-actions">
              <Button type="primary" onClick={organizeIdea} disabled={!ideaText.trim()}>
                帮我整理
              </Button>
              {organizeMessage && <span>{organizeMessage}</span>}
            </div>
            {selectedProjectNotes.length > 0 && (
              <div className="note-history">
                <span>最近收纳</span>
                {selectedProjectNotes.map((note) => (
                  <p key={note.id}>{note.rawText}</p>
                ))}
              </div>
            )}
          </Card>

          <Card className="detail-panel morning-panel">
            <h2>晨间复盘</h2>
            <p>
              <Typewriter speed={32} trigger={`${selectedProject.id}-${selectedOpenTasks}-${selectedDoneTasks}`}>
                {morningSummary}
              </Typewriter>
            </p>
          </Card>
        </section>

        <CreateProjectModal
          open={isCreateOpen}
          projectName={projectName}
          projectDescription={projectDescription}
          setProjectName={setProjectName}
          setProjectDescription={setProjectDescription}
          onClose={closeCreateModal}
          onCreate={createProject}
        />
      </main>
      </Cursor>
    );
  }

  return (
    <Cursor>
    <main className="app-shell">
      <section className="island-topbar" aria-label="项目总览">
        <div>
          <p className="eyebrow">ADHD Animal Island Memo</p>
          <h1>今天先照看哪座小岛？</h1>
          <p className="support-text">
            念头可以跳来跳去，项目会留在原地等你回来。
          </p>
        </div>
        <div className="time-wrap">
          <Time />
        </div>
      </section>

      <section className="summary-strip" aria-label="当前状态">
        <Card color="default" className="summary-card">
          <Typewriter speed={28}>
            现在有 {projects.length} 个项目，{totalOpenTasks} 个还没完成的小任务。
          </Typewriter>
        </Card>
        <Button type="primary" size="large" onClick={() => setIsCreateOpen(true)}>
          开岛
        </Button>
      </section>

      <section className="project-grid" aria-label="项目列表">
        {projects.map((project) => (
          <Card
            key={project.id}
            color={project.color}
            className={[
              'project-card',
              armedProjectId === project.id && 'project-card-armed',
              draggedProjectId === project.id && 'project-card-dragging',
            ]
              .filter(Boolean)
              .join(' ')}
            draggable={armedProjectId === project.id}
            onPointerDown={(event) => handleProjectPressStart(event, project.id)}
            onPointerUp={clearProjectPressTimer}
            onPointerCancel={clearProjectPressTimer}
            onPointerLeave={clearProjectPressTimer}
            onDragStart={(event) => handleProjectDragStart(event, project.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dragProjectId = event.dataTransfer.getData('text/plain');
              if (dragProjectId) moveProjectBefore(dragProjectId, project.id);
              finishProjectDrag();
            }}
            onDragEnd={finishProjectDrag}
          >
            <div>
              <span className="project-pill">{project.updatedAt}</span>
              <h2>{project.name}</h2>
              <p>{project.description}</p>
            </div>
            <div className="project-footer">
              <span>{openTaskCount(project.id)} 个待办</span>
              <Button
                size="small"
                type="default"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setSelectedProjectId(project.id)}
              >
                进入
              </Button>
            </div>
          </Card>
        ))}
      </section>

      {(armedProjectId || draggedProjectId) && (
        <div
          className="project-trash"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const projectId = event.dataTransfer.getData('text/plain');
            if (projectId) deleteProject(projectId);
            finishProjectDrag();
          }}
        >
          <span>拖到这里删除项目</span>
        </div>
      )}

      <CreateProjectModal
        open={isCreateOpen}
        projectName={projectName}
        projectDescription={projectDescription}
        setProjectName={setProjectName}
        setProjectDescription={setProjectDescription}
        onClose={closeCreateModal}
        onCreate={createProject}
      />
    </main>
    </Cursor>
  );
}

type CreateProjectModalProps = {
  open: boolean;
  projectName: string;
  projectDescription: string;
  setProjectName: (value: string) => void;
  setProjectDescription: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
};

function CreateProjectModal({
  open,
  projectName,
  projectDescription,
  setProjectName,
  setProjectDescription,
  onClose,
  onCreate,
}: CreateProjectModalProps) {
  return (
    <Modal
      open={open}
      title="开一座新小岛"
      width={560}
      typewriter={false}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>先等等</Button>
          <Button type="primary" onClick={onCreate} disabled={!projectName.trim()}>
            开岛
          </Button>
        </>
      }
    >
      <div className="create-form">
        <label>
          <span>项目名称</span>
          <Input
            size="large"
            shadow
            value={projectName}
            placeholder="这座小岛叫什么？"
            onChange={(event) => setProjectName(event.target.value)}
          />
        </label>
        <label>
          <span>一句话描述</span>
          <Input
            size="large"
            shadow
            value={projectDescription}
            placeholder="它现在主要是关于什么？"
            onChange={(event) => setProjectDescription(event.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

function IslandTree({ stage }: { stage: number }) {
  return (
    <div className={`island-tree tree-stage-${stage}`} aria-label={`小树等级 ${stage}`}>
      <div className="tree-sparkle tree-sparkle-one" />
      <div className="tree-sparkle tree-sparkle-two" />
      <div className="tree-ground">
        <span />
        <span />
      </div>
      <div className="tree-trunk" />
      <div className="tree-leaf tree-leaf-left" />
      <div className="tree-leaf tree-leaf-center" />
      <div className="tree-leaf tree-leaf-right" />
      <div className="tree-sprout tree-sprout-left" />
      <div className="tree-sprout tree-sprout-right" />
    </div>
  );
}
