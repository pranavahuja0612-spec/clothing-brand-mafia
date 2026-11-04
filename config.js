// All game numbers live here. Balance the game by editing this file only.
const CONFIG = {
  saveKey: "clothingBrandMafia.save.v1",
  saveVersion: 1,

  startingCash: 100,

  // Day 1 placeholder income, earned every second even with no orders.
  // Replaced by the real order loop on Day 2.
  baseIncomePerSecond: 1,

  tickMs: 100,            // how often the game loop runs
  autosaveMs: 5000,       // how often progress is saved

  offlineCapHours: 8,     // offline earnings stop after this long
  offlineMinSeconds: 60,  // shorter absences show no welcome-back message
};
