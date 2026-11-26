/* 蓝牙一问一答的队列。
 *
 * 桩的蓝牙回复队列只有 4 行，满了以后新的应答直接丢掉、没有提示；不认识的命令也不回任何
 * 东西（文档/04-协议/M01蓝牙协议.md 第 2.3 节）。所以 App 一次只让一条命令在路上：发一条，
 * 等到它的应答或超时，再发下一条。各个页面的读取、保存、每秒一次的单路详情都从这里走，
 * 谁也挤不掉谁。心跳不走这里，由 MainActivity 每秒单独发。
 *
 *   const q = createQueue({ send, now?, setTimer?, clearTimer? });
 *   const line = await q.ask(command, accept, ms, { consume });
 *       发 command，等 accept(line) 为真的那一行；超时返回 null。
 *       consume 为真：这一行只给等它的人，界面别的地方不再处理（q.feed 返回 true）。
 *   q.feed(line)    每收到一行调一次
 *   q.idle()        没有在路上的，也没有排着的。轮询只在空闲时才排进来
 *   q.reset()       断开连接：在路上的和排着的都按超时算（返回 null） */
export function createQueue(io) {
  const setTimer = io.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = io.clearTimer || ((id) => clearTimeout(id));
  const waiting = [];
  let current = null;

  function finish(line) {
    const job = current;
    if (!job) return;
    current = null;
    clearTimer(job.timer);
    job.resolve(line);
    pump();
  }

  function pump() {
    if (current || !waiting.length) return;
    const job = waiting.shift();
    current = job;
    job.timer = setTimer(() => {
      if (current === job) finish(null);
    }, job.ms);
    io.send(job.command);
  }

  return {
    ask(command, accept, ms, opts) {
      return new Promise((resolve) => {
        waiting.push({
          command,
          accept,
          ms: ms > 0 ? ms : 2000,
          consume: !!(opts && opts.consume),
          resolve,
          timer: 0,
        });
        pump();
      });
    },
    feed(line) {
      const job = current;
      if (!job) return false;
      let hit = false;
      try { hit = !!job.accept(line); } catch (e) { hit = false; }
      if (!hit) return false;
      finish(line);
      return job.consume;
    },
    idle() {
      return !current && waiting.length === 0;
    },
    pending() {
      return (current ? 1 : 0) + waiting.length;
    },
    reset() {
      const jobs = waiting.splice(0);
      const job = current;
      current = null;
      if (job) {
        clearTimer(job.timer);
        job.resolve(null);
      }
      jobs.forEach((item) => item.resolve(null));
    },
  };
}
