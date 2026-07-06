export interface TranscriptSegment {
  t: number; // seconds from recording start
  text: string;
  who?: 'me' | 'them'; // me = microphone, them = system audio; absent on old recordings
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  at: number; // epoch ms
}

export interface Meeting {
  id: string;
  title: string;
  createdAt: number; // epoch ms
  template: string;
  transcript: TranscriptSegment[];
  notes: string; // user's sparse notes (plain text)
  enhanced: string; // AI-enhanced notes (markdown), '' until enhanced
  chat: ChatMessage[];
  exportFile?: string; // last markdown file exported to the Obsidian folder
}

export interface MeetingSummary {
  id: string;
  title: string;
  createdAt: number;
  hasEnhanced: boolean;
}
