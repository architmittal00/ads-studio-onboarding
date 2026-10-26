/** Manual placements: the positions offered per platform (Meta's `facebook_positions` / `instagram_positions` keys). */
export interface PositionOption { key: string; label: string }

export const FB_POSITIONS: PositionOption[] = [
  { key: 'feed', label: 'Feed' },
  { key: 'story', label: 'Stories' },
  { key: 'facebook_reels', label: 'Reels' },
  { key: 'video_feeds', label: 'Video feeds' },
  { key: 'marketplace', label: 'Marketplace' },
  { key: 'search', label: 'Search results' },
  { key: 'right_hand_column', label: 'Right column' },
  { key: 'profile_feed', label: 'Profile feed' },
];
export const IG_POSITIONS: PositionOption[] = [
  { key: 'stream', label: 'Feed' },
  { key: 'story', label: 'Stories' },
  { key: 'reels', label: 'Reels' },
  { key: 'explore', label: 'Explore' },
  { key: 'explore_home', label: 'Explore home' },
  { key: 'profile_feed', label: 'Profile feed' },
  { key: 'ig_search', label: 'Search results' },
];
export const ALL_FB_POSITIONS = FB_POSITIONS.map((p) => p.key);
export const ALL_IG_POSITIONS = IG_POSITIONS.map((p) => p.key);
