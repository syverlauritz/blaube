// A session's plan: its todo list, as Claude keeps it with TodoWrite (or
// the newer TaskCreate / TaskUpdate tools). Each item is { id, text,
// status } with status 'pending', 'in_progress' or 'completed'. The slime
// wears it as a row of beads, so you can see how far along it is.

const MAX = 30;

// The plan after one finished tool call (a PostToolUse payload), or the
// same plan when the call wasn't about it.
function planAfter(plan, p) {
  const items = (plan && plan.items) || [];
  const input = (p && p.tool_input) || {};
  const resp = p && p.tool_response && typeof p.tool_response === 'object' ? p.tool_response : {};
  switch (p && p.tool_name) {
    case 'TodoWrite':
      if (!Array.isArray(input.todos)) return plan;
      return { items: input.todos.slice(0, MAX).map((t, i) => ({ id: String(t.id || i + 1), text: String(t.activeForm && t.status === 'in_progress' ? t.activeForm : t.content || ''), status: statusOf(t.status) })) };
    case 'TaskCreate': {
      if (items.length >= MAX) return plan;
      const task = resp.task && typeof resp.task === 'object' ? resp.task : resp;
      const id = String(task.id || task.taskId || items.length + 1);
      if (items.some((t) => t.id === id)) return plan;
      return { items: [...items, { id, text: String(input.subject || input.description || ''), status: 'pending' }] };
    }
    case 'TaskUpdate': {
      const id = String(input.taskId || input.id || '');
      if (!items.some((t) => t.id === id)) return plan;
      if (input.status === 'deleted') return { items: items.filter((t) => t.id !== id) };
      return { items: items.map((t) => t.id !== id ? t : Object.assign({}, t, input.status ? { status: statusOf(input.status) } : {}, input.subject ? { text: String(input.subject) } : {})) };
    }
    default:
      return plan;
  }
}

function statusOf(s) {
  return s === 'completed' || s === 'in_progress' ? s : 'pending';
}

// How far along: { done, total, current } (current is the item being
// worked on, or ''), or null without a plan.
function progress(plan) {
  const items = (plan && plan.items) || [];
  if (!items.length) return null;
  const now = items.find((t) => t.status === 'in_progress');
  return { done: items.filter((t) => t.status === 'completed').length, total: items.length, current: now ? now.text : '' };
}

module.exports = { planAfter, progress };
