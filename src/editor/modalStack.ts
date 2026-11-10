// 開いているモーダルの数と重なり順 (ui/Modal.tsx が更新し、キー操作の判定に使う)
const stack: symbol[] = [];

export function pushModal(id: symbol): void {
  stack.push(id);
}

export function removeModal(id: symbol): void {
  const i = stack.lastIndexOf(id);
  if (i >= 0) stack.splice(i, 1);
}

/** いちばん上のモーダルか */
export function isTopModal(id: symbol): boolean {
  return stack[stack.length - 1] === id;
}

/** Modal が 1 つ以上開いているか */
export function isModalOpen(): boolean {
  return stack.length > 0;
}
