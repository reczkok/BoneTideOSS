import type { App } from './app.ts';
import type { Loadout } from '@bonetide/engine/game/loadout.ts';
import type { Talents } from '@bonetide/engine/game/talents.ts';
import { BRANCH_ORDER, ABILITY_INFO, TREE, type BranchId } from '@bonetide/engine/game/tree.ts';

const branchLabel = (branch: BranchId) =>
  branch === 'knight' ? 'Knight' : (ABILITY_INFO[branch]?.name ?? branch);

export function createTreeUi(deps: {
  talents: Talents;
  loadout: Loadout;
  app: App;
  sfx(id: string): void;
}) {
  const { talents, app } = deps;
  const viewport = document.getElementById('tree-viewport') as HTMLElement;
  const pointsEl = document.getElementById('tree-points') as HTMLElement;
  const continueBtn = document.getElementById('tree-continue') as HTMLButtonElement;

  const onContinue = () => app.to('playing');
  continueBtn.addEventListener('click', onContinue);

  function render() {
    const points = talents.points;
    pointsEl.textContent = `${points} unspent point${points === 1 ? '' : 's'}`;
    viewport.replaceChildren();
    for (const branch of BRANCH_ORDER) {
      const nodes = TREE.filter((node) => node.branch === branch);
      if (nodes.length === 0) continue;
      const column = document.createElement('div');
      column.className = 'tree-branch';
      const heading = document.createElement('h3');
      heading.textContent = branchLabel(branch);
      column.append(heading);
      for (const node of nodes) {
        const ranks = talents.ranks(node.id);
        const buyable = talents.canBuy(node);
        const row = document.createElement('button');
        row.className = 'tree-node';
        row.classList.toggle('owned', ranks > 0);
        row.classList.toggle('buyable', buyable);
        row.disabled = !buyable;
        row.title = node.desc;
        const name = document.createElement('span');
        name.className = 'tree-node-name';
        name.textContent = node.name;
        const rank = document.createElement('span');
        rank.className = 'tree-node-rank';
        rank.textContent = `${ranks}/${node.maxRanks}`;
        const desc = document.createElement('span');
        desc.className = 'tree-node-desc';
        desc.textContent = node.desc;
        row.append(name, rank, desc);
        row.addEventListener('click', () => {
          if (!talents.buy(node.id)) return;
          deps.sfx('ui_click');
          render();
        });
        column.append(row);
      }
      viewport.append(column);
    }
  }

  render();

  return {
    render,
    dispose() {
      continueBtn.removeEventListener('click', onContinue);
      viewport.replaceChildren();
    },
  };
}
