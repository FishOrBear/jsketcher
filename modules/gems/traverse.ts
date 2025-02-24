/**
 * 深度优先搜索(DFS)遍历实现
 * @param node 起始节点
 * @param children 获取子节点的函数，接收当前节点和消费者函数作为参数
 * @param callback 处理节点的回调函数，如果返回true则终止遍历
 * @returns 如果遍历被callback终止则返回true，否则返回undefined
 */
export function dfs<T>(node: T,
  children: (node: T, consumer: (node: T) => void) => void,
  callback: (node: T) => any): boolean {

  const visited = new Set<T>();

  const stack = [];
  stack.push(node);
  while (stack.length)
  {
    const node = stack.pop();
    if (visited.has(node))
      continue;
    visited.add(node);
    if (callback(node))
      return true;
    children(node, child => stack.push(child));
  }
}

/**
 * 广度优先搜索(BFS)遍历实现
 * @param node 起始节点
 * @param children 获取子节点的函数，接收当前节点和消费者函数作为参数
 * @param callback 处理节点的回调函数，如果返回true则终止遍历
 * @returns 如果遍历被callback终止则返回true，否则返回undefined
 */
export function bfs<T>(node: T,
  children: (node: T, consumer: (node: T) => void) => void,
  callback: (node: T) => any): boolean {

  const visited = new Set<T>();
  const queue = [];
  queue.unshift(node);
  while (queue.length)
  {
    const node = queue.pop();
    if (visited.has(node))
    {
      continue;
    }
    visited.add(node);
    if (callback(node))
    {
      return true;
    }
    children(node, child => queue.push(child));
  }
}
