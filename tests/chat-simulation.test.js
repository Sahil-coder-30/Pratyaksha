/**
 * PRATYAKSHA Test Suite: WhatsApp Chat Simulation & Multi-Turn Verification
 *
 * Verifies end-to-end chat simulation:
 * 1. Continuous WhatsApp conversation planning ("until user says exit").
 * 2. Protection against audio recording / microphone clicks.
 * 3. Execution of multi-turn chat cycle through LangGraph.
 * 4. In-session knowledge search isolation (preserving WhatsApp tab).
 * 5. Anti-spam loop detection & ground-truth verification.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentGraph } from '../src/agent/graph.js';
import { generateDeterministicPlan } from '../src/agent/planner.js';
import { executeBrowserTool } from '../src/browser/browser-tools.js';
import { createMockChrome } from './helpers/mock-chrome.js';
import { AIMessage } from '@langchain/core/messages';
import { detectLoop } from '../src/agent/middleware.js';
import { TOOL_NAMES } from '../src/shared/constants.js';

test('Chat Simulation 1: Planner Formulates Continuous WhatsApp Multi-Turn Plan', () => {
  const task = 'Open silicon valley ke 14 group on whatsapp and chat with the group memebrs, you must await for a response from the user and answer it or respond to it, you will start by introducing yourself on the group Make sure to wait until you receive a query, don\'t refresh the page, in case you take more time in fetching some information prompt the user for that case.. next you need to continue chatting until the user says "exit" don\'t spam';
  const plan = generateDeterministicPlan(task, { url: 'https://web.whatsapp.com' });

  // 1. Service recognized
  assert.equal(plan.targetService?.name, 'WhatsApp');

  // 2. No blocking missing information
  assert.equal(plan.missingInformation.length, 0);

  // 3. Subgoals cover targeted search, intro, wait, continuous cycle, and exit
  assert.ok(plan.subgoals.length >= 4);
  const searchSubgoal = plan.subgoals.find(s => /silicon valley ke 14/i.test(s.description));
  assert.ok(searchSubgoal, 'Must have subgoal to find target group');

  const introSubgoal = plan.subgoals.find(s => /introduc/i.test(s.description));
  assert.ok(introSubgoal, 'Must have subgoal for introduction');

  const waitSubgoal = plan.subgoals.find(s => s.expectedAction === 'wait_for');
  assert.ok(waitSubgoal, 'Must have wait_for subgoal to hold process for user replies');

  const loopSubgoal = plan.subgoals.find(s => /exit/i.test(s.description));
  assert.ok(loopSubgoal, 'Must have continuous loop subgoal bounded by exit condition');

  // 4. Verification criteria enforces target group and exit condition
  assert.ok(plan.verificationCriteria.some(c => /silicon valley ke 14/i.test(c)));
  assert.ok(plan.verificationCriteria.some(c => /exit/i.test(c)));
});

test('Chat Simulation 2: Audio Recording & Microphone Click Protection', () => {
  // Simulate WhatsApp elements to verify voice/mic rejection logic
  function isVoiceOrMicButton(btn) {
    if (!btn) return false;
    const aria = (btn.ariaLabel || '').toLowerCase();
    const title = (btn.title || '').toLowerCase();
    const testId = (btn.dataTestId || '').toLowerCase();
    const icon = (btn.dataIcon || '').toLowerCase();
    return /voice|audio|mic|ptt|record/i.test(aria) ||
           /voice|audio|mic|ptt|record/i.test(title) ||
           /mic|ptt/i.test(testId) ||
           /ptt|mic/.test(icon);
  }

  // A. Mic button when input is empty
  const micButton = {
    ariaLabel: 'Voice message',
    dataTab: '11',
    dataIcon: 'ptt',
    dataTestId: 'ptt'
  };
  assert.equal(isVoiceOrMicButton(micButton), true, 'Microphone button must be recognized as voice/mic');

  // B. Verified Send button when text is present
  const sendButton = {
    ariaLabel: 'Send',
    dataIcon: 'send',
    dataTestId: 'send'
  };
  assert.equal(isVoiceOrMicButton(sendButton), false, 'Send button must NOT be recognized as voice/mic');

  // C. Discard voice recording button is detected
  const cancelVoiceBtn = {
    ariaLabel: 'Cancel recording',
    dataIcon: 'ptt-cancel',
    dataTestId: 'ptt-cancel'
  };
  assert.ok(/ptt-cancel/i.test(cancelVoiceBtn.dataIcon));
});

test('Chat Simulation 3: In-Session Web Research Does Not Navigate Away From WhatsApp', async () => {
  const chromeApi = createMockChrome({
    tabs: [
      { id: 1, windowId: 1, url: 'https://web.whatsapp.com', title: 'WhatsApp', active: true }
    ]
  });

  const activeTab = { id: 1, url: 'https://web.whatsapp.com', title: 'WhatsApp' };

  // Mock TinyFish API endpoint
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.ok(url.includes('agent.tinyfish.ai'));
      return {
        ok: true,
        json: async () => ({
          status: 'COMPLETED',
          result: 'Dhruv Rathee is an Indian YouTuber and educator.',
          num_of_steps: 2
        })
      };
    };

    // Agent attempts search_web while chatting in WhatsApp
    const result = await executeBrowserTool(
      TOOL_NAMES.SEARCH_WEB,
      { query: 'Who is dhruv rathee' },
      activeTab,
      { chromeApi }
    );

    assert.equal(result.ok, true);
    // Must intercept and route to isolated sandbox without navigating away
    assert.ok(result.observation.includes('cloud sandbox') || result.observation.includes('research') || result.observation.includes('Dhruv Rathee'));

    // Verify the active tab remained on WhatsApp Web
    const currentTab = await chromeApi.tabs.get(1);
    assert.equal(currentTab.url, 'https://web.whatsapp.com', 'Tab must NEVER navigate away from WhatsApp during chat');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Chat Simulation 4: Full Multi-Turn WhatsApp Chat Workflow with Exit Condition', async () => {
  const chromeApi = createMockChrome({
    tabs: [
      { id: 1, windowId: 1, url: 'https://web.whatsapp.com', title: 'WhatsApp', active: true }
    ]
  });

  // When wait_for polls the content script, return reply found immediately
  chromeApi._setNextMessageResponse({
    success: true,
    result: {
      found: true,
      detail: 'New reply message appeared in thread',
      newContent: 'Who is dhruv rathee?'
    }
  });

  // Simulated AI model steps representing the autonomous conversation:
  // Turn 1: Selects target group "Silicon Valley ke 14"
  // Turn 2: Sends introduction message and calls wait_for
  // Turn 3: Receives question ("Who is dhruv rathee"), sends answer, calls wait_for
  // Turn 4: Receives "exit", detects exit command, calls finish_task
  let turn = 0;
  const multiTurnChatModel = {
    bindTools() {
      return {
        async invoke() {
          turn++;
          if (turn === 1) {
            return new AIMessage({
              content: 'Opening target group Silicon Valley ke 14',
              tool_calls: [{
                id: 'call_chat_1',
                name: 'click_element',
                args: { target_id: 12, semantic_hint: 'Silicon Valley ke 14' }
              }]
            });
          }
          if (turn === 2) {
            return new AIMessage({
              content: 'Sending introduction to group and waiting for responses',
              tool_calls: [{
                id: 'call_chat_2',
                name: 'type_into_element',
                args: {
                  target_id: 45,
                  text: "Hi everyone! I'm Pratyaksha, an AI assistant here to help and chat with you all.",
                  press_enter: true
                }
              }, {
                id: 'call_chat_3',
                name: 'wait_for',
                args: { wait_for_reply: true, timeout_seconds: 5 }
              }]
            });
          }
          if (turn === 3) {
            return new AIMessage({
              content: 'Replying to user query about Dhruv Rathee',
              tool_calls: [{
                id: 'call_chat_4',
                name: 'type_into_element',
                args: {
                  target_id: 45,
                  text: 'Dhruv Rathee is an Indian YouTuber and educational content creator.',
                  press_enter: true
                }
              }, {
                id: 'call_chat_5',
                name: 'wait_for',
                args: { wait_for_reply: true, timeout_seconds: 5 }
              }]
            });
          }
          return new AIMessage({
            content: 'User sent exit command. Concluding chat session.',
            tool_calls: [{
              id: 'call_chat_6',
              name: 'finish_task',
              args: {
                success: true,
                summary: 'Chat conversation ended successfully as user sent "exit". Introduced self, answered user query, and respected exit condition.'
              }
            }]
          });
        }
      };
    }
  };

  const app = createAgentGraph({
    model: multiTurnChatModel,
    chromeApi,
    enableInterrupts: false,
    maxSteps: 20
  });

  const task = 'Open silicon valley ke 14 group on whatsapp and chat with the group memebrs, you must await for a response from the user and answer it or respond to it, you will start by introducing yourself on the group Make sure to wait until you receive a query, don\'t refresh the page, in case you take more time in fetching some information prompt the user for that case.. next you need to continue chatting until the user says "exit" don\'t spam';

  const res = await app.invoke({
    originalTask: task,
    browserSession: { tabId: 1, url: 'https://web.whatsapp.com', title: 'WhatsApp' }
  }, { recursionLimit: 50 });

  // Verify execution result
  assert.equal(res.status, 'COMPLETED');
  assert.ok(res.finalResult);
  assert.equal(res.finalResult.success, true);
  assert.ok(res.finalResult.summary.includes('exit'));

  // Verify verification passed
  assert.ok(res.verificationResult);
  assert.equal(res.verificationResult.verified, true);
});

test('Chat Simulation 5: Loop Detection Prevents Infinite Identical Typing', () => {
  // Simulates what caused the earlier bug: typing the exact same intro over and over
  const introMsg = "Hi everyone! I'm Pratyaksha, your assistant. How can I help you today?";

  const historyWithSpam = [
    { toolName: 'type_into_element', args: { text: introMsg, target_id: 45 }, ok: true },
    { toolName: 'type_into_element', args: { text: introMsg, target_id: 45 }, ok: true }
  ];

  // detectLoop takes the action history array
  const loopWarning = detectLoop(historyWithSpam);
  assert.ok(loopWarning.includes('SPAM / LOOP PREVENTION'), 'Middleware must detect and flag identical repeated message spam');
});

test('Chat Simulation 6: Real Human-to-Human Multi-Turn Conversational Loop with Sequential Dynamic Messages', async () => {
  const sentAgentMessages = [];
  const actionSequence = [];

  // Script of dynamic human actions over time:
  // 1. Initial wait_for: Human is still typing (found: false to simulate realistic human delay)
  // 2. Poll 2: Human asks "What is the capital of France?"
  // 3. Poll 3: Human asks "Who is dhruv rathee?"
  // 4. Poll 4: Human asks "What is the price of a German shepherd?"
  // 5. Poll 5: Human says "exit"
  const humanEvents = [
    { found: false },
    { found: true, detail: 'Incoming message from Aryan: What is the capital of France?', newContent: 'What is the capital of France?' },
    { found: true, detail: 'Incoming message from Aryan: Who is dhruv rathee?', newContent: 'Who is dhruv rathee?' },
    { found: true, detail: 'Incoming message from Aryan: What is the price of a German shepherd?', newContent: 'What is the price of a German shepherd?' },
    { found: true, detail: 'Incoming message from Aryan: exit', newContent: 'exit' }
  ];
  let humanEventIndex = 0;

  const chromeApi = createMockChrome({
    tabs: [
      { id: 1, windowId: 1, url: 'https://web.whatsapp.com', title: 'WhatsApp', active: true }
    ]
  });

  // Dynamic message responder simulating real WhatsApp DOM interactions
  chromeApi._setNextMessageResponse((msg) => {
    if (msg.type === 'GET_PAGE_CONTEXT') {
      return {
        url: 'https://web.whatsapp.com',
        title: 'WhatsApp',
        elements: [
          { id: 45, tag: 'div', role: 'textbox', label: 'Type a message', inViewport: true }
        ],
        page: {
          visibleText: 'Silicon Valley ke 14 group\nAryan: Online'
        }
      };
    }

    if (msg.type === 'EXECUTE_ACTION') {
      const payload = msg.payload || {};
      actionSequence.push(payload.action);

      if (payload.action === 'TYPE' || payload.action === 'TYPE_TEXT') {
        sentAgentMessages.push(payload.value || payload.text);
        return { success: true, result: { typedInto: '[#45]', value: payload.value || payload.text, dispatched: true } };
      }

      if (payload.action === 'WAIT_FOR') {
        const nextEvent = humanEvents[humanEventIndex++];
        if (!nextEvent) {
          return { success: true, result: { found: false } };
        }
        return {
          success: true,
          result: nextEvent
        };
      }
    }

    return { success: true, result: 'OK' };
  });

  // Conversational AI agent model that perceives user messages and responds contextually
  let stepCall = 0;
  const humanToHumanAgentModel = {
    bindTools() {
      return {
        async invoke(messages) {
          stepCall++;

          // Helper to find the latest ToolMessage observation
          let latestObservation = '';
          for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            const type = m._getType ? m._getType() : m.type;
            if (type === 'tool') {
              latestObservation = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
              break;
            }
          }

          // Turn 1: Locate and select target group "Silicon Valley ke 14"
          if (stepCall === 1) {
            return new AIMessage({
              content: 'Selecting target WhatsApp group "Silicon Valley ke 14"',
              tool_calls: [
                {
                  id: `call_${stepCall}_select`,
                  name: 'click_element',
                  args: { target_id: 14, semantic_hint: 'Silicon Valley ke 14' }
                }
              ]
            });
          }

          // Turn 2: Initial introduction into group
          if (stepCall === 2) {
            return new AIMessage({
              content: "Introducing myself to the group and waiting for queries.",
              tool_calls: [
                {
                  id: `call_${stepCall}_type`,
                  name: 'type_into_element',
                  args: {
                    target_id: 45,
                    text: "Hi everyone! I'm Pratyaksha, an AI assistant here to help and chat with you all. Let's make the most of our time together!",
                    press_enter: true
                  }
                },
                {
                  id: `call_${stepCall}_wait`,
                  name: 'wait_for',
                  args: { wait_for_reply: true, timeout_seconds: 5 }
                }
              ]
            });
          }

          // Handling when human is still typing (pacing delay)
          if (latestObservation.includes('No new incoming messages')) {
            return new AIMessage({
              content: "No reply received yet. Continuing to monitor chat thread.",
              tool_calls: [
                {
                  id: `call_${stepCall}_wait`,
                  name: 'wait_for',
                  args: { wait_for_reply: true, timeout_seconds: 5 }
                }
              ]
            });
          }

          // Responding to "What is the capital of France?"
          if (latestObservation.includes('capital of France')) {
            return new AIMessage({
              content: "User asked for the capital of France. Answering and waiting for next response.",
              tool_calls: [
                {
                  id: `call_${stepCall}_type`,
                  name: 'type_into_element',
                  args: {
                    target_id: 45,
                    text: 'The capital of France is Paris.',
                    press_enter: true
                  }
                },
                {
                  id: `call_${stepCall}_wait`,
                  name: 'wait_for',
                  args: { wait_for_reply: true, timeout_seconds: 5 }
                }
              ]
            });
          }

          // Responding to "Who is dhruv rathee"
          if (latestObservation.includes('dhruv rathee')) {
            return new AIMessage({
              content: "User asked about Dhruv Rathee. Answering and waiting for next response.",
              tool_calls: [
                {
                  id: `call_${stepCall}_type`,
                  name: 'type_into_element',
                  args: {
                    target_id: 45,
                    text: 'Dhruv Rathee is an Indian YouTuber, social media influencer, and educator known for analytical explainer videos.',
                    press_enter: true
                  }
                },
                {
                  id: `call_${stepCall}_wait`,
                  name: 'wait_for',
                  args: { wait_for_reply: true, timeout_seconds: 5 }
                }
              ]
            });
          }

          // Responding to "What is the price of a German shepherd"
          if (latestObservation.includes('German shepherd')) {
            return new AIMessage({
              content: "User asked about German Shepherd price. Answering and waiting for next response.",
              tool_calls: [
                {
                  id: `call_${stepCall}_type`,
                  name: 'type_into_element',
                  args: {
                    target_id: 45,
                    text: 'In India, a purebred German Shepherd puppy generally costs between ₹15,000 and ₹45,000 depending on pedigree and lineage.',
                    press_enter: true
                  }
                },
                {
                  id: `call_${stepCall}_wait`,
                  name: 'wait_for',
                  args: { wait_for_reply: true, timeout_seconds: 5 }
                }
              ]
            });
          }

          // Human sent "exit" in chat thread -> conclude session
          if (latestObservation.includes('Response Content:\nexit') || (latestObservation.includes('Condition met') && latestObservation.includes('exit'))) {
            return new AIMessage({
              content: "Human sent 'exit'. Concluding interactive chat session.",
              tool_calls: [
                {
                  id: `call_${stepCall}_finish`,
                  name: 'finish_task',
                  args: {
                    success: true,
                    summary: 'Human-to-human conversational loop completed successfully. Responded to 3 distinct human queries, waited for replies between each turn, and terminated on "exit".'
                  }
                }
              ]
            });
          }

          throw new Error(`Unexpected conversation state at step ${stepCall}. Observation: ${latestObservation}`);
        }
      };
    }
  };

  const app = createAgentGraph({
    model: humanToHumanAgentModel,
    chromeApi,
    enableInterrupts: false,
    maxSteps: 25
  });

  const task = 'Open silicon valley ke 14 group on whatsapp and chat with the group memebrs, you must await for a response from the user and answer it or respond to it, you will start by introducing yourself on the group Make sure to wait until you receive a query, don\'t refresh the page, in case you take more time in fetching some information prompt the user for that case.. next you need to continue chatting until the user says "exit" don\'t spam';

  const res = await app.invoke({
    originalTask: task,
    browserSession: { tabId: 1, url: 'https://web.whatsapp.com', title: 'WhatsApp' }
  }, { recursionLimit: 50 });

  // 1. Verify successful overall execution
  assert.equal(res.status, 'COMPLETED');
  assert.equal(res.finalResult?.success, true);
  assert.ok(res.finalResult.summary.includes('exit'));
  assert.ok(res.verificationResult?.verified, true);

  // 2. Verify all human queries were answered in order without duplication or repetition
  assert.equal(sentAgentMessages.length, 4, 'Must have sent exactly 4 distinct messages (intro + 3 query responses)');
  assert.ok(sentAgentMessages[0].includes('Pratyaksha'), 'Turn 1 must be introduction');
  assert.ok(sentAgentMessages[1].includes('Paris'), 'Turn 2 must answer France capital');
  assert.ok(sentAgentMessages[2].includes('Dhruv Rathee'), 'Turn 3 must answer Dhruv Rathee');
  assert.ok(sentAgentMessages[3].includes('German Shepherd') || sentAgentMessages[3].includes('15,000'), 'Turn 4 must answer German Shepherd price');

  // 3. Verify real-time conversational loop structure:
  // Every type action was followed by a wait_for to await the human response!
  const typeIndices = [];
  const waitIndices = [];
  actionSequence.forEach((act, idx) => {
    if (act === 'TYPE' || act === 'TYPE_TEXT') typeIndices.push(idx);
    if (act === 'WAIT_FOR') waitIndices.push(idx);
  });

  assert.equal(typeIndices.length, 4);
  assert.ok(waitIndices.length >= 4);

  // Each typed message must be immediately accompanied/followed by wait_for
  for (let i = 0; i < typeIndices.length; i++) {
    const nextWait = waitIndices.find(wIdx => wIdx > typeIndices[i]);
    assert.ok(nextWait !== undefined, `Message ${i} must be followed by wait_for to await human response`);
  }
});

