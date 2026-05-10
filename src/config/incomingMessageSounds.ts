export const INCOMING_MESSAGE_SOUNDS = [
  {
    id: "fortnite-death",
    label: "Fortnite Death",
    file: "assets/sounds/notifications/fortnite-death.wav",
  },
  {
    id: "fortnite-map-ui",
    label: "Fortnite Map UI",
    file: "assets/sounds/notifications/fortnite-map-ui.wav",
  },
  {
    id: "mario-bros",
    label: "Mario Bros",
    file: "assets/sounds/notifications/mario-bros.wav",
  },
  {
    id: "mario-bros-paused",
    label: "Mario Bros Paused",
    file: "assets/sounds/notifications/mario-bros-paused.wav",
  },
  {
    id: "mario-coin",
    label: "Mario Coin",
    file: "assets/sounds/notifications/mario-coin.wav",
  },
  {
    id: "mario-jump",
    label: "Mario Jump",
    file: "assets/sounds/notifications/mario-jump.wav",
  },
  {
    id: "minecraft-level-up",
    label: "Minecraft Level Up",
    file: "assets/sounds/notifications/minecraft-level-up.wav",
  },
  {
    id: "minecraft-villager",
    label: "Minecraft Villager",
    file: "assets/sounds/notifications/minecraft-villager.wav",
  },
  {
    id: "one-up",
    label: "1-Up",
    file: "assets/sounds/notifications/one-up.wav",
  },
] as const;

export const DEFAULT_INCOMING_MESSAGE_SOUND_ID =
  INCOMING_MESSAGE_SOUNDS[0].id;

export function getIncomingMessageSoundById(id: string) {
  return (
    INCOMING_MESSAGE_SOUNDS.find((item) => item.id === id) ||
    INCOMING_MESSAGE_SOUNDS[0]
  );
}