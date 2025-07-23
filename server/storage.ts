import { users, type User, type InsertUser } from "@shared/schema";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_PATH = path.join(__dirname, "storage.json");

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  currentId: number;

  constructor() {
    this.users = new Map();
    this.currentId = 1;
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }
}

export const storage = new MemStorage();

export function loadAppStorage() {
  if (!fs.existsSync(STORAGE_PATH)) {
    return { 
      validRooms: [], 
      chatMessages: {}, 
      roomHosts: {},
      whiteboardStates: {} 
    };
  }
  try {
    const data = JSON.parse(fs.readFileSync(STORAGE_PATH, "utf-8"));
    // Ensure all required properties exist
    return {
      validRooms: data.validRooms || [],
      chatMessages: data.chatMessages || {},
      roomHosts: data.roomHosts || {},
      whiteboardStates: data.whiteboardStates || {}
    };
  } catch (e) {
    return { 
      validRooms: [], 
      chatMessages: {}, 
      roomHosts: {},
      whiteboardStates: {} 
    };
  }
}

export function saveAppStorage(data: any) {
  console.log("Saving to storage.json...");
  fs.writeFileSync(STORAGE_PATH, JSON.stringify(data, null, 2), "utf-8");
}
