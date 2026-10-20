/**
 * PRATYAKSHA Test Suite: Code Editor Interaction & Problem-Solving Simulation
 *
 * Verifies end-to-end coding platform support:
 * 1. Deterministic planning for LeetCode / coding tasks.
 * 2. Monaco & CodeMirror editor recognition.
 * 3. Pre-action typeability validation (rejecting typing into buttons without blacklisting them).
 * 4. Conversational code-dump circuit breaker.
 * 5. Ground-truth coding platform verification gate (enforcing injection & verdict).
 * 6. Browser tool execution for write_code_editor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDeterministicPlan } from '../src/agent/planner.js';
import { validateToolCall } from '../src/agent/middleware.js';
import { verifyTaskOutcome, VERIFICATION_OUTCOMES } from '../src/agent/verifier.js';
import { decideRecoveryStrategy, RECOVERY_DECISIONS } from '../src/agent/recovery.js';
import { executeBrowserTool } from '../src/browser/browser-tools.js';
import { TOOL_NAMES } from '../src/shared/constants.js';
import { createMockChrome } from './helpers/mock-chrome.js';

test('Coding Simulation 1: Planner Formulates Deterministic LeetCode Execution Plan', () => {
  const task = 'open leetcode.com and solve two sum - leetcode problem (1) question for me and submit the code';
  const plan = generateDeterministicPlan(task, { url: 'https://leetcode.com' });

  // 1. Service recognized
  assert.equal(plan.targetService?.name, 'LeetCode');

  // 2. No blocking missing info
  assert.equal(plan.missingInformation.length, 0);

  // 3. Subgoals cover navigation, code injection, submit, and waiting for verdict
  assert.ok(plan.subgoals.length >= 4, `Expected at least 4 subgoals, got ${plan.subgoals.length}`);

  const navSubgoal = plan.subgoals.find(s => s.expectedAction === 'open_url');
  assert.ok(navSubgoal, 'Must have subgoal to navigate to problem');

  const editorSubgoal = plan.subgoals.find(s => s.expectedAction === 'write_code_editor');
  assert.ok(editorSubgoal, 'Must have subgoal to inject code into editor');

  const submitSubgoal = plan.subgoals.find(s => s.expectedAction === 'click_element' && /submit/i.test(s.description));
  assert.ok(submitSubgoal, 'Must have subgoal to click Submit');

  const verdictSubgoal = plan.subgoals.find(s => s.expectedAction === 'wait_for');
  assert.ok(verdictSubgoal, 'Must have subgoal to wait for verdict');

  // 4. Verification criteria enforces editor injection and verdict observation
  assert.ok(plan.verificationCriteria.some(c => /solution|editor/i.test(c)), 'Must require code injection in criteria');
  assert.ok(plan.verificationCriteria.some(c => /verdict|submit/i.test(c)), 'Must require verdict in criteria');
});

test('Coding Simulation 2: Pre-Action Typeability Gate Prevents Typing into Buttons', () => {
  const elements = [
    { id: 14, tag: 'input', role: 'searchbox', name: 'search' },
    { id: 77, tag: 'button', role: 'button', text: 'Submit' },
    { id: 78, tag: 'editor', role: 'code-editor', text: 'var twoSum = function...' },
    { id: 80, tag: 'a', role: 'link', text: 'Problems' }
  ];

  // 1. Trying to type code into button #77 must be rejected by pre-action validation
  const invalidTypeCall = {
    name: 'type_into_element',
    args: { target_id: 77, text: 'var twoSum = function(nums, target) { return []; };' }
  };
  const valResult = validateToolCall(invalidTypeCall, [], elements);
  assert.equal(valResult.valid, false);
  assert.equal(valResult.nonRetryableAction, true);
  assert.match(valResult.reason, /not an editable field/i);

  // 2. Recovery strategy for typeability error must NOT blacklist button #77!
  const recovery = decideRecoveryStrategy({
    consecutiveFailures: 1,
    lastError: { message: valResult.reason },
    lastAction: invalidTypeCall
  });
  // Since it was a typeability error, it must NOT return BLACKLIST_AND_PIVOT for the button
  assert.notEqual(recovery.decision, RECOVERY_DECISIONS.BLACKLIST_AND_PIVOT, 'Button must not be blacklisted on typeability error');

  // 3. Typing into editor #78 or input #14 must be valid
  const validEditorCall = {
    name: 'write_code_editor',
    args: { target_id: 78, code: 'var twoSum = function(nums, target) { return []; };' }
  };
  const editorVal = validateToolCall(validEditorCall, [], elements);
  assert.equal(editorVal.valid, true);

  const validTypeCall = {
    name: 'type_into_element',
    args: { target_id: 14, text: 'Two Sum' }
  };
  const inputVal = validateToolCall(validTypeCall, [], elements);
  assert.equal(inputVal.valid, true);
});

test('Coding Simulation 3: Ground-Truth Coding Platform Verification Gate', () => {
  const task = 'open leetcode.com and solve two sum - leetcode problem (1) question for me and submit the code';

  // Scenario A: Model claims finish without injecting code into editor
  const noCodeRes = verifyTaskOutcome({
    task,
    currentUrl: 'https://leetcode.com/problems/two-sum',
    actionHistory: [
      { toolName: 'open_url', ok: true, url: 'https://leetcode.com/problems/two-sum' }
    ],
    latestObservation: { isFinished: true, success: true, summary: 'Solved Two Sum in chat' }
  });
  assert.equal(noCodeRes.verified, false);
  assert.equal(noCodeRes.outcome, VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE);
  assert.match(noCodeRes.reason, /Code solution was not injected into the code editor/i);

  // Scenario B: Code was injected, but Submit was not clicked
  const noSubmitRes = verifyTaskOutcome({
    task,
    currentUrl: 'https://leetcode.com/problems/two-sum',
    actionHistory: [
      { toolName: 'open_url', ok: true, url: 'https://leetcode.com/problems/two-sum' },
      { toolName: 'write_code_editor', ok: true, observation: 'Successfully injected 15 lines of code into monaco editor' }
    ],
    latestObservation: { isFinished: true, success: true, summary: 'Code written' }
  });
  assert.equal(noSubmitRes.verified, false);
  assert.equal(noSubmitRes.outcome, VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE);
  assert.match(noSubmitRes.reason, /Submit button was not clicked/i);

  // Scenario C: Code was injected and Submit was clicked, but verdict was not awaited
  const noVerdictRes = verifyTaskOutcome({
    task,
    currentUrl: 'https://leetcode.com/problems/two-sum',
    actionHistory: [
      { toolName: 'open_url', ok: true, url: 'https://leetcode.com/problems/two-sum' },
      { toolName: 'write_code_editor', ok: true, observation: 'Successfully injected 15 lines of code into monaco editor' },
      { toolName: 'click_element', ok: true, args: { semantic_hint: 'Submit' }, observation: 'Clicked Submit button' }
    ],
    latestObservation: { isFinished: true, success: true, summary: 'Submitted code' }
  });
  assert.equal(noVerdictRes.verified, false);
  assert.equal(noVerdictRes.outcome, VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE);
  assert.match(noVerdictRes.reason, /submission verdict.*not confirmed/i);

  // Scenario D: Full workflow with Accepted verdict confirmed
  const successRes = verifyTaskOutcome({
    task,
    currentUrl: 'https://leetcode.com/problems/two-sum',
    actionHistory: [
      { toolName: 'open_url', ok: true, url: 'https://leetcode.com/problems/two-sum' },
      { toolName: 'write_code_editor', ok: true, observation: 'Successfully injected 15 lines of code into monaco editor' },
      { toolName: 'click_element', ok: true, args: { semantic_hint: 'Submit' }, observation: 'Clicked Submit button' },
      { toolName: 'wait_for', ok: true, metadata: { met: true }, observation: 'Condition met: found text "Accepted"' }
    ],
    latestObservation: { isFinished: true, success: true, summary: 'Accepted: Runtime 54ms' }
  });
  assert.equal(successRes.verified, true);
  assert.equal(successRes.outcome, VERIFICATION_OUTCOMES.VERIFIED_SUCCESS);

  // Scenario E: wait_for timed out without finding Accepted -> must reject completion!
  const timeoutRes = verifyTaskOutcome({
    task,
    currentUrl: 'https://leetcode.com/problems/two-sum',
    actionHistory: [
      { toolName: 'open_url', ok: true, url: 'https://leetcode.com/problems/two-sum' },
      { toolName: 'write_code_editor', ok: true, observation: 'Successfully injected 15 lines of code into monaco editor' },
      { toolName: 'click_element', ok: true, args: { semantic_hint: 'Submit' }, observation: 'Clicked Submit button' },
      { toolName: 'wait_for', ok: true, metadata: { met: false, waiting: true }, observation: 'Polled DOM for 10s: No new incoming messages or changes detected.' }
    ],
    latestObservation: { isFinished: true, success: true, summary: 'The solution has been submitted and the verdict is Accepted.' }
  });
  assert.equal(timeoutRes.verified, false);
  assert.equal(timeoutRes.outcome, VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE);
  assert.match(timeoutRes.reason, /Accepted.*not confirmed/i);

  // Scenario F: Judge returned Compile Error (due to duplicated class/template) -> must reject with error!
  const compileErrorRes = verifyTaskOutcome({
    task,
    currentUrl: 'https://leetcode.com/problems/two-sum',
    actionHistory: [
      { toolName: 'open_url', ok: true, url: 'https://leetcode.com/problems/two-sum' },
      { toolName: 'write_code_editor', ok: true, observation: 'Successfully injected 15 lines of code into monaco editor' },
      { toolName: 'click_element', ok: true, args: { semantic_hint: 'Submit' }, observation: 'Clicked Submit button' },
      { toolName: 'wait_for', ok: true, metadata: { met: true }, observation: 'Condition met: found text "Compile Error"' }
    ],
    latestObservation: { isFinished: true, success: true, summary: 'Done' }
  });
  assert.equal(compileErrorRes.verified, false);
  assert.equal(compileErrorRes.outcome, VERIFICATION_OUTCOMES.INCOMPLETE_RECOVERABLE);
  assert.match(compileErrorRes.reason, /error verdict.*Compile Error/i);
});

test('Coding Simulation 4: executeBrowserTool for write_code_editor Dispatches WRITE_CODE Action', async () => {
  const mockTab = { id: 101, url: 'https://leetcode.com/problems/two-sum', title: 'Two Sum - LeetCode' };
  const chromeApi = createMockChrome({
    tabs: [mockTab]
  });

  chromeApi._setNextMessageResponse({
    success: true,
    result: {
      typedInto: '#editor-container',
      editorType: 'monaco',
      lines: 12,
      codeLength: 320
    }
  });

  const codeString = `function twoSum(nums, target) {
    const map = new Map();
    for (int i = 0; i < nums.length; i++) {
        const diff = target - nums[i];
        if (map.has(diff)) return [map.get(diff), i];
        map.set(nums[i], i);
    }
    return [];
}`;

  const result = await executeBrowserTool(
    TOOL_NAMES.WRITE_CODE_EDITOR,
    { target_id: 78, code: codeString, language: 'javascript' },
    mockTab,
    { chromeApi }
  );

  assert.equal(result.ok, true);
  const sentMsg = chromeApi._state.messagesSent[0]?.message;
  assert.ok(sentMsg);
  assert.equal(sentMsg.payload.action, 'WRITE_CODE');
  assert.equal(sentMsg.payload.target_id, 78);
  assert.equal(sentMsg.payload.code, codeString);
  assert.equal(result.metadata.codeModified, true);
  assert.equal(result.metadata.editorType, 'monaco');
  assert.match(result.observation, /Successfully injected 12 lines of code into monaco/i);
});

test('Coding Simulation 5: Planner Formulates Template Clearing Plan for Fix Requests', () => {
  const fixTask = 'no the solution is not accepted. you pasted the solution before the template. class Solution { ... } looks like this now. fix this';
  const plan = generateDeterministicPlan(fixTask, { url: 'https://leetcode.com/problems/two-sum' });

  assert.equal(plan.targetService?.name, 'LeetCode');
  assert.ok(plan.subgoals.length >= 3);

  // Must have clear editor subgoal
  const clearSubgoal = plan.subgoals.find(s => s.expectedAction === 'write_code_editor' && /clear|wipe/i.test(s.description));
  assert.ok(clearSubgoal, 'Must have subgoal to wipe duplicate template');

  // Must have submit subgoal
  const submitSubgoal = plan.subgoals.find(s => s.expectedAction === 'click_element');
  assert.ok(submitSubgoal, 'Must have subgoal to click submit');

  // Must have wait for accepted subgoal
  const waitSubgoal = plan.subgoals.find(s => s.expectedAction === 'wait_for');
  assert.ok(waitSubgoal, 'Must have subgoal to wait for Accepted verdict');
});

test('Coding Simulation 6: Tier-1 executeScript in MAIN World Replaces Monaco Model Directly', async () => {
  let executedScriptConfig = null;
  const mockTab = { id: 101, url: 'https://leetcode.com/problems/two-sum', title: 'Two Sum - LeetCode' };
  const chromeApi = createMockChrome({
    tabs: [mockTab]
  });

  chromeApi.scripting = {
    executeScript: async (config) => {
      executedScriptConfig = config;
      return [{
        result: {
          success: true,
          editorType: 'monaco',
          lines: 14
        }
      }];
    }
  };

  const codeString = `#include <vector>
#include <unordered_map>
class Solution {
public:
    std::vector<int> twoSum(std::vector<int>& nums, int target) {
        std::unordered_map<int, int> map;
        for (int i = 0; i < nums.size(); ++i) {
            int complement = target - nums[i];
            if (map.count(complement)) return {map[complement], i};
            map[nums[i]] = i;
        }
        return {};
    }
};`;

  const res = await executeBrowserTool(
    TOOL_NAMES.WRITE_CODE_EDITOR,
    { target_id: 72, code: codeString, language: 'cpp' },
    mockTab,
    { chromeApi }
  );

  assert.equal(res.ok, true);
  assert.ok(executedScriptConfig);
  assert.equal(executedScriptConfig.world, 'MAIN');
  assert.equal(executedScriptConfig.target.tabId, 101);
  assert.match(res.observation, /Existing template completely replaced/i);
  assert.equal(res.metadata.editorType, 'monaco');
  assert.equal(res.metadata.codeModified, true);
});
