export function cardOrigin(board, view, move) {
  const seat = board.querySelector(`[data-seat="${move.seat}"]`);
  // Only the local hand has identifiable cards. The outermost back is visible
  // above the rest of a concealed hand.
  const source = move.seat === view.seat
    ? seat?.querySelector(`.hand > [data-key="${move.card}"]`)
    : seat?.querySelector('.opponent-hand > .card:last-child');
  return source?.getBoundingClientRect();
}

async function animate(element, keyframes, duration, easing, signal) {
  if (signal.aborted) return;
  const motion = element.animate(keyframes, { duration, easing, fill: 'both' });
  const cancel = () => motion.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await motion.finished;
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    motion.cancel();
  }
}

export async function flyCard(card, origin, signal) {
  const target = card.getBoundingClientRect();
  if (!target.width || !target.height) return;
  const x = origin.left - target.left;
  const y = origin.top - target.top;
  const scaleX = origin.width / target.width;
  const scaleY = origin.height / target.height;
  card.classList.add('in-flight');
  try {
    // This is the actual top card. Its normal layout position is the endpoint.
    await animate(card, [
      { transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})` },
      { transform: 'none' },
    ], 260, 'cubic-bezier(.2,.68,.24,1)', signal);
  } finally {
    card.classList.remove('in-flight');
  }
}

export async function sweepPile(pile, card, origin, signal) {
  const top = card.getBoundingClientRect();
  const x = origin ? (origin.left + origin.width / 2 - top.left - top.width / 2) * .45 : 0;
  const y = origin ? (origin.top + origin.height / 2 - top.top - top.height / 2) * .45 : 0;
  pile.classList.add('sweeping');
  await animate(pile, [
    { transform: 'none', opacity: 1 },
    { offset: .45, opacity: 1 },
    { transform: `translate(${x}px, ${y}px) scale(.65)`, opacity: 0 },
  ], 160, 'ease-in', signal);
}
