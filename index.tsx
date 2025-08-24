/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Chat } from "@google/genai";
import { marked } from "marked";
import DOMPurify from "dompurify";

// Defer API key access until main() is called to prevent script-load errors.
let API_KEY: string | undefined;
let ai: GoogleGenAI;

// --- STATE MANAGEMENT ---
const fileSystem = {
    '~': {
        type: 'dir',
        children: {
            'documents': {
                type: 'dir',
                children: { 'report.docx': { type: 'file' } }
            },
            'images': {
                type: 'dir',
                children: { 'photo.jpg': { type: 'file' }, 'vacation.png': { type: 'file' } }
            },
            'music': {
                type: 'dir',
                children: {}
            },
            'file1.txt': { type: 'file' },
        }
    }
};
let currentPath = ['~'];

// --- DOM ELEMENTS ---
let terminalOutput: HTMLElement;
let terminalInput: HTMLInputElement;
let terminalContainer: HTMLElement;
let promptElement: HTMLElement;
let fileSystemTree: HTMLElement;
let goalInput: HTMLTextAreaElement;
let goalSubmitBtn: HTMLButtonElement;
let goalOutput: HTMLElement;
let chat: Chat;


// --- AI CONFIGURATION ---
const getSystemInstruction = (path: string) => `You are an expert tutor and a Linux terminal emulator.
The user is a beginner learning command-line skills.
The user's current directory is '${path}'.
The emulated file system is: ${JSON.stringify(fileSystem, null, 2)}.
When the user enters a command, respond with a realistic-looking output for that command.
For 'ls', list the contents of the current directory.
For 'pwd', the response should be '/home/user' for '~' or '/home/user/path' for '~/path'.
Keep responses concise and formatted as if they are coming from a real terminal.
Do not add extra explanations unless asked. Do not break character.`;


/**
 * Initializes the AI client and chat model.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
async function initializeChat(): Promise<boolean> {
  try {
    if (!API_KEY) {
        throw new Error("API Key has not been initialized.");
    }
    ai = new GoogleGenAI({ apiKey: API_KEY });
    chat = ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction: getSystemInstruction(currentPath.join('/')),
      },
    });
    return true;
  } catch(e) {
     console.error(e);
     // appendToTerminal might not work if the DOM isn't ready, but it's our best shot.
     if (terminalOutput) {
        appendToTerminal(`Critical Error: Could not initialize AI model. The app is non-functional. Please check your API key and network connection, then refresh the page.`, 'error');
     }
     return false;
  }
}

// --- TERMINAL & FILE SYSTEM LOGIC ---

/**
 * Renders the file system tree view.
 */
function renderFileSystem() {
    if (!fileSystemTree) return;

    const createTree = (dir: any, currentLevelPath: string): HTMLUListElement => {
        const ul = document.createElement('ul');
        for (const name in dir.children) {
            const item = dir.children[name];
            const li = document.createElement('li');
            const itemPath = `${currentLevelPath}/${name}`.replace('~/', '');
            const fullPathString = currentPath.slice(1).join('/');

            const iconSpan = document.createElement('span');
            iconSpan.className = 'icon';
            iconSpan.textContent = item.type === 'dir' ? '📁' : '📄';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'name';
            nameSpan.textContent = name;

            li.appendChild(iconSpan);
            li.appendChild(nameSpan);

            if (item.type === 'dir') {
                li.classList.add('directory');
                const childrenUl = createTree(item, `${currentLevelPath}/${name}`);
                li.appendChild(childrenUl);
            } else {
                li.classList.add('file');
            }

            if (itemPath === fullPathString) {
                li.classList.add('active');
            }
            ul.appendChild(li);
        }
        return ul;
    };

    fileSystemTree.innerHTML = '';
    const rootUl = document.createElement('ul');
    const root = document.createElement('li');

    const rootIcon = document.createElement('span');
    rootIcon.className = 'icon';
    rootIcon.textContent = '🏠';

    const rootName = document.createElement('span');
    rootName.className = 'name';
    rootName.textContent = '~';

    root.appendChild(rootIcon);
    root.appendChild(rootName);

    root.classList.add('directory');
    if (currentPath.join('/') === '~') {
        root.classList.add('active');
    }
    root.appendChild(createTree(fileSystem['~'], '~'));
    rootUl.appendChild(root);
    fileSystemTree.appendChild(rootUl);
}


/**
 * Appends a line of text to the terminal output.
 * @param text The text to append.
 * @param type The type of log ('command', 'response', 'error').
 * @returns The element that was appended.
 */
function appendToTerminal(text: string, type: 'command' | 'response' | 'error'): HTMLElement {
  const line = document.createElement('div');
  line.classList.add(`log-${type}`);
  if (type === 'command') {
    const promptSpan = document.createElement('span');
    promptSpan.className = 'prompt';
    promptSpan.textContent = promptElement.textContent || '';

    const commandSpan = document.createElement('span');
    commandSpan.className = 'command-text';
    commandSpan.textContent = text;

    line.appendChild(promptSpan);
    line.appendChild(document.createTextNode(' '));
    line.appendChild(commandSpan);
  } else {
    // Using textContent is safe against XSS.
    line.textContent = text;
  }
  terminalOutput.appendChild(line);
  scrollToBottom();
  return line;
}

/**
 * Gets a directory object from the file system based on a path.
 * @param pathParts The path parts array.
 * @returns The directory object or null if not found.
 */
function getDirectory(pathParts: string[]) {
    let currentLevel: any = fileSystem;
    for (const part of pathParts) {
        if (part === '~') {
            currentLevel = currentLevel['~'];
        } else if (currentLevel && currentLevel.type === 'dir' && currentLevel.children[part]) {
            currentLevel = currentLevel.children[part];
        } else {
            return null;
        }
    }
    return currentLevel;
}

/**
 * Handles the 'cd' command client-side.
 * @param arg The argument for the cd command.
 */
function handleCd(arg: string) {
    if (!arg || arg === '~') {
        currentPath = ['~'];
    } else {
        const newPathParts = arg.startsWith('~') ? arg.split('/') : [...currentPath, ...arg.split('/')];
        const resolvedPath = [];
        for (const part of newPathParts) {
            if (part === '..') {
                if (resolvedPath.length > 1) resolvedPath.pop();
            } else if (part !== '.' && part !== '') {
                resolvedPath.push(part);
            }
        }
        
        const targetDir = getDirectory(resolvedPath);
        if (targetDir && targetDir.type === 'dir') {
            currentPath = resolvedPath;
        } else {
            appendToTerminal(`bash: cd: ${arg}: No such file or directory`, 'error');
            return;
        }
    }
    
    // Update UI
    const displayPath = currentPath.length === 1 ? '~' : `~/${currentPath.slice(1).join('/')}`;
    promptElement.textContent = `user@gemini:${displayPath}$`;
    renderFileSystem();
    // Re-create the chat session to update the system instruction with the new path
    try {
        chat = ai.chats.create({
            model: 'gemini-2.5-flash',
            config: {
              systemInstruction: getSystemInstruction(currentPath.join('/')),
            },
        });
    } catch (e) {
        console.error("Failed to re-initialize chat after 'cd'", e);
        appendToTerminal(`Error: Failed to update context for new directory. Terminal may not respond correctly.`, 'error');
    }
}

/**
 * Sends a command to the AI and appends the response.
 * @param command The command to send.
 */
async function runCommand(command: string) {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) return;

  appendToTerminal(trimmedCommand, 'command');
  terminalInput.value = '';
  
  const [cmd, ...args] = trimmedCommand.split(/\s+/);

  if (cmd === 'cd') {
      handleCd(args.join(' '));
      scrollToBottom();
      return;
  }

  terminalInput.disabled = true;

  try {
    const response = await chat.sendMessage({ message: trimmedCommand });
    const text = response.text;
    if (text) {
        appendToTerminal(text, 'response');
    }
  } catch (e) {
    console.error(e);
    appendToTerminal(`Error: ${(e as Error).message}`, 'error');
  } finally {
    terminalInput.disabled = false;
    terminalInput.focus();
    scrollToBottom();
  }
}

/**
 * Gets a tutorial from the AI for a user-defined goal.
 */
async function getGoalExplanation() {
    const goal = goalInput.value.trim();
    if (!goal) return;

    goalSubmitBtn.disabled = true;
    goalInput.disabled = true;
    goalOutput.innerHTML = 'Thinking...';

    try {
        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `The user wants to learn how to do the following in a Linux terminal: "${goal}". 
            Provide a clear, step-by-step guide using markdown. 
            Use code blocks for commands. Keep it simple for a beginner.`,
        });
        const text = result.text;
        goalOutput.innerHTML = DOMPurify.sanitize(marked.parse(text) as string);
    } catch(e) {
        console.error(e);
        goalOutput.innerHTML = `<div class="log-error">Sorry, I couldn't generate a guide for that. Please try again.</div>`
    } finally {
        goalSubmitBtn.disabled = false;
        goalInput.disabled = false;
    }
}


/**
 * Scrolls the terminal to the bottom.
 */
function scrollToBottom() {
  terminalContainer.scrollTop = terminalContainer.scrollHeight;
}

/**
 * Sets up all event listeners for the app.
 */
function setupEventListeners() {
    terminalInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            runCommand(terminalInput.value);
        }
    });

    terminalContainer.addEventListener('click', () => {
        terminalInput.focus();
    });

    document.querySelectorAll('.command-bubble').forEach(button => {
        button.addEventListener('click', () => {
            const command = (button as HTMLElement).dataset.command;
            if(command) {
                terminalInput.value = command;
                terminalInput.focus();
            }
        });
    });

    goalSubmitBtn.addEventListener('click', getGoalExplanation);

    document.querySelectorAll('#sidebar li.disabled').forEach(item => {
        item.addEventListener('click', () => {
            alert('This lesson is not yet implemented, but will be coming soon!');
        });
    });
}

/**
 * Main app initialization
 */
async function main() {
    try {
        // Access the API key here to avoid potential script-load errors in some environments.
        API_KEY = typeof process !== 'undefined' && process.env ? process.env.API_KEY : undefined;
        
        if (!API_KEY) {
            document.body.innerHTML = `
              <div class="error-container">
                <h1>Configuration Error</h1>
                <p>The application could not start because the API Key is missing. Please ensure it is configured correctly.</p>
              </div>`;
            console.error("Missing API Key. Please set the API_KEY environment variable.");
            return;
        }

        // Assign DOM elements
        terminalOutput = document.getElementById('terminal-output') as HTMLElement;
        terminalInput = document.getElementById('terminal-input') as HTMLInputElement;
        terminalContainer = document.getElementById('terminal') as HTMLElement;
        promptElement = document.querySelector('#terminal-input-line .prompt') as HTMLElement;
        fileSystemTree = document.getElementById('filesystem-tree') as HTMLElement;
        goalInput = document.getElementById('goal-input') as HTMLTextAreaElement;
        goalSubmitBtn = document.getElementById('goal-submit-btn') as HTMLButtonElement;
        goalOutput = document.getElementById('goal-output') as HTMLElement;
        

        if (!terminalOutput || !terminalInput || !terminalContainer || !fileSystemTree || !goalInput || !goalSubmitBtn || !goalOutput || !promptElement) {
            console.error("Initialization failed: Could not find required elements in the DOM.");
            document.body.innerHTML = `<div class="error-container"><h1>App Error</h1><p>App failed to load. Critical elements are missing.</p></div>`;
            return;
        }

        // Disable inputs during setup
        terminalInput.disabled = true;
        goalSubmitBtn.disabled = true;
        goalInput.disabled = true;

        setupEventListeners();
        appendToTerminal('Initializing AI Tutor...', 'response');

        const chatInitialized = await initializeChat();
        
        if (chatInitialized) {
            renderFileSystem();
            appendToTerminal('AI Tutor initialized. Start by typing a command or clicking a bubble.', 'response');
            terminalInput.disabled = false;
            goalSubmitBtn.disabled = false;
            goalInput.disabled = false;
            terminalInput.focus();
        }
        // If initialization fails, inputs remain disabled and an error is shown.
    } catch (error) {
        console.error("A critical error occurred during app initialization:", error);
        document.body.innerHTML = `
          <div class="error-container">
            <h1>Application Error</h1>
            <p>A fatal error occurred and the application could not start. Please try reloading the page. For more details, check the browser's developer console.</p>
          </div>`;
    }
}

// Wait for the DOM to be fully loaded before running the app logic.
document.addEventListener('DOMContentLoaded', main);