// 核心服務的建立工具：從世界包建立一組預設服務（時間、實體、背包、內容過濾）。
// 瀏覽器相關的服務（存檔後端、輸入、鏡頭、介面外殼）不在這裡，放在 src/shell。
import { createTime } from './time.js';
import { createEntities } from './entities.js';
import { createInventory } from './inventory.js';
import { defaultTextFilter } from '../textfilter.js';

export { createTime, createEntities, createInventory };

export function createCoreServices(data = {}, { time = {}, now } = {}) {
  return {
    time: createTime({ now, ...(data.pack?.time || {}), ...time }),
    entities: createEntities(),
    inventory: createInventory({ items: data.items || [], slots: data.pack?.inventorySlots ?? 20 }),
    textFilter: defaultTextFilter,
  };
}
