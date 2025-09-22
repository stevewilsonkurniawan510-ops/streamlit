# AI Assistant: GitHub Pull Request Creation

Please create a PR following the instructions below.

## Quick Reference for AI Assistants

1. **ALWAYS START WITH STEP 1**: Ask user to choose approach (Already Ready/Automated/Interactive)
2. **Execute chosen mode**: Validate, prepare, or guide based on selection
3. **Analyze changes**: Determine if Width/Height parameter addition or General PR
4. **Create PR**: Use appropriate template and run `gh pr create` command directly

## AI Assistant Instructions

**⚠️ CRITICAL: ALWAYS START WITH STEP 1**

When asked to create a PR, an AI assistant MUST first ask the user to choose their approach before taking any other actions. Do not analyze git status, check branches, or run any commands until the user has chosen their preferred mode.

### Step 1: Choose User Interaction Mode (REQUIRED FIRST STEP)

**ALWAYS ask the user to choose their preferred approach first:**

> "How would you like to proceed with creating the PR?
>
> 1. **Already Ready**: I already have a feature branch with all changes committed and pushed to remote - just create the PR
> 2. **Automated**: Handle branch creation, staging, committing, and pushing for me automatically
> 3. **Interactive**: Guide me through each step manually so I can run the commands myself"

**Three approaches available:**

- **Already Ready**: User has already prepared branch and pushed changes - validate readiness then proceed to PR creation
- **Automated**: AI handles all git operations and PR creation automatically
- **Interactive**: User performs each step with AI guidance and prompts

**Wait for user response before proceeding to Step 2.**

### Step 2: Execute Chosen Mode

#### Mode A: Already Ready

If user chooses "Already Ready", first validate their setup:

1. **Validate branch readiness**

   ```bash
   # Check current branch and status
   git branch --show-current
   git status

   # Verify branch exists on remote
   git branch -r | grep $(git branch --show-current)

   # Check latest commit
   git log --oneline -1
   ```

2. **Confirm readiness with user**

   After running validation commands, confirm:

   - User is on a feature branch (not main/develop)
   - Branch is pushed to remote
   - All changes are committed
   - Ready to create PR

3. **If validated, proceed directly to Step 3: Execute PR Creation Approach**

4. **If issues found, offer to switch to Automated or Interactive mode**

#### Mode B: Automated Approach

If user chooses automated, proceed with these steps:

1. **Analyze current state and create feature branch**

   ```bash
   # Check current status
   git status
   git branch --show-current

   # Create feature branch with descriptive name
   # Branch naming convention: {type}/{brief-description}
   # Types: feature, fix, refactor, chore, docs
   # Examples: feature/plotly-height, fix/chart-rendering, refactor/element-cleanup
   git checkout -b {type}/{descriptive-name}
   ```

   **Branch Naming Examples:**

   - `feature/plotly-height` - Adding height parameter to plotly charts
   - `feature/width-support` - Adding width support to elements
   - `fix/chart-rendering` - Fixing a chart rendering bug
   - `refactor/element-cleanup` - Refactoring element code
   - `chore/dependency-update` - Updating dependencies

2. **Stage all changes**

   ```bash
   git add .
   ```

3. **Create commit with descriptive message**

   ```bash
   git commit -m "Descriptive commit message based on changes"
   ```

4. **Push branch to remote**

   ```bash
   git push --set-upstream origin feature/{descriptive-name}
   ```

5. **Create PR automatically** (proceed to Step 3 below)

#### Mode C: Interactive Approach

If user chooses interactive, guide them through each step:

1. **Check current branch status**

   Ask user to run:

   ```bash
   git branch --show-current
   git status
   ```

   **Prompt:** "Please run the above commands and let me know when you're ready to proceed. We need to ensure you're on a feature branch (not main/develop)."

2. **Create feature branch (if needed)**

   If user is on main/develop, ask them to create a feature branch:

   ```bash
   # Branch naming convention: {type}/{brief-description}
   # Types: feature, fix, refactor, chore, docs
   # Examples: feature/plotly-height, fix/chart-rendering, refactor/element-cleanup
   git checkout -b {type}/{descriptive-name}
   ```

   **Branch Naming Examples:**

   - `feature/plotly-height` - Adding height parameter to plotly charts
   - `feature/width-support` - Adding width support to elements
   - `fix/chart-rendering` - Fixing a chart rendering bug
   - `refactor/element-cleanup` - Refactoring element code
   - `chore/dependency-update` - Updating dependencies

   **Prompt:** "Please create a feature branch using the naming convention above, then let me know when you're ready for the next step."

3. **Stage and commit changes**

   Ask user to stage their changes:

   ```bash
   git add {specific-files}
   # or to add all changes:
   git add .
   ```

   **Prompt:** "Please stage the changes you want to include in the PR and let me know when you're ready to commit."

   Then ask them to commit:

   ```bash
   git commit -m "Descriptive commit message"
   ```

   **Prompt:** "Please create a commit with a descriptive message and let me know when it's done."

4. **Push to remote**

   Ask user to push:

   ```bash
   git push --set-upstream origin $(git branch --show-current)
   ```

   **Prompt:** "Please push your branch to remote and let me know when you're ready for PR creation."

5. **Create PR automatically** (proceed to Step 3 below)

### Step 3: Execute PR Creation Approach

**IMPORTANT: Analyze changes to determine the correct PR type before creating PR.**

1. **Examine the committed changes to determine PR type:**

   ```bash
   # Analyze what files and code were changed
   git diff HEAD~1 --name-only
   git show --stat HEAD
   git show HEAD --name-only
   ```

2. **Determine PR approach based on changes:**

   Look for these patterns in the changes:

   **→ Use Approach A (Width/Height Parameter Addition) if:**

   - Changes add `width` or `height` parameters to Streamlit elements (e.g., `st.plotly_chart`, `st.vega_lite_chart`)
   - Files modified include element implementation files (e.g., `lib/streamlit/elements/`)
   - Branch name contains terms like "width", "height", "plotly", "vega", etc.
   - Commit messages mention width/height parameter additions

   **→ Use Approach B (General PR Creation) for:**

   - All other types of changes (bug fixes, refactoring, new features not related to width/height)
   - Documentation updates
   - Internal changes

3. **Once determined, proceed with the appropriate approach below:**

#### Approach A: Width/Height Parameter Addition

For PRs that add or modernize width/height parameters:

**Create PR using GitHub CLI:**

Determine labels (always use these for width/height parameter additions):

- `security-assessment-completed`
- `impact:users` (changes user-facing API)
- `change:feature` (adds new functionality)

**Execute these commands (AI should run these directly, not just provide them):**

```bash
# Generate PR description using width/height template (see template below)
cat > pr_description.md << 'EOF'
[Width/Height PR description content - use template below]
EOF

# Create PR with appropriate title format
gh pr create --title "[WIP][AdvancedLayouts] Add {dimension} to st.{element_name}" \
             --body-file pr_description.md \
             --base develop \
             --label "security-assessment-completed,impact:users,change:feature" \
             --draft
```

**AI should:**

1. Generate the correct PR description using the Width/Height template
2. Replace placeholders (e.g., `{element_name}`, `{dimension}`) with actual values from the changes
3. Execute the `gh pr create` command directly
4. Provide the PR URL to the user

#### Approach B: General PR Creation

For all other types of PRs:

**Create PR using GitHub CLI:**

First, determine appropriate labels based on the Required Labels section below:

- Always include: `security-assessment-completed`
- Choose impact: `impact:users` or `impact:internal`
- Choose change type: `change:feature`, `change:bugfix`, `change:chore`, `change:refactor`, or `change:other`

**Execute these commands (AI should run these directly, not just provide them):**

```bash
# Generate PR description using general template (see template below)
cat > pr_description.md << 'EOF'
[General PR description content - use template below]
EOF

# Create PR with descriptive title
gh pr create --title "Descriptive PR Title Based on Changes" \
             --body-file pr_description.md \
             --base develop \
             --label "<appropriate-labels>" \
             --draft
```

**AI should:**

1. Analyze the changes to determine appropriate labels (security-assessment-completed + impact + change type)
2. Generate a descriptive PR title based on branch name and commit messages
3. Create PR description using the General template
4. Execute the `gh pr create` command directly
5. Provide the PR URL to the user

### Step 4: Generate PR Content

**Generate PR title and description** based on:

- Branch name
- Commit messages
- Code changes made
- Chosen approach and corresponding template

## PR Description Template

### Streamlit PR Template

```markdown
## Describe your changes

Brief description of what this PR accomplishes.

<!-- If it's a visual change, please include a screenshot or video! -->

**Changes Made:**

- List key changes
- Include any new features
- Mention any breaking changes

## GitHub Issue Link (if applicable)

## Testing Plan

- [ ] Unit Tests (JS and/or Python)
- [ ] E2E Tests
- [ ] Manual testing completed
- [ ] Explanation of why no additional tests are needed (if applicable)

**Screenshots/Demos:**
(If UI changes, include screenshots or GIFs)

**Additional Notes:**
Any other relevant information for reviewers.

---

**Contribution License Agreement**

By submitting this pull request you agree that all contributions to this project are made under the Apache 2.0 license.
```

### Template for Adding/Extending Width/Height Parameters

**Title Format**:

- `[WIP][AdvancedLayouts] Add width to st.{element_name}`
- `[WIP][AdvancedLayouts] Add height to st.{element_name}`

**Note**: When using this template, replace the placeholders as follows:

- `{dimension}` → `width` or `height`
- `{Dimension}` → `Width` or `Height`
- `{element_name}` → actual element name (e.g., `vega_lite_chart`)
- `{library}` → chart library name (e.g., `altair`, `plotly`)
- `{Object}` → chart object type (e.g., `Chart`, `Figure`)

**Usage Instructions**:

**Step 1: Determine if parameter is new or existing**

- **New parameter**: Element doesn't currently have this dimension parameter
- **Modernizing existing**: Element already has this dimension parameter, updating it to use new type system

**Step 2: Apply dimension-specific rules**

- **Width parameters**: May have `use_container_width` deprecation (only if modernizing existing)
- **Height parameters**: Never have deprecation (no `use_container_height` exists)

**Step 3: Choose appropriate sections**

**For new width parameter**:

- Use "new parameters" sections
- Keep deprecation sections commented out (no existing parameter to deprecate)

**For new height parameter**:

- Use "new parameters" sections
- Keep deprecation sections commented out (no deprecation exists for height)

**For modernizing existing width parameter**:

- Use "modernizing existing parameters" sections
- Uncomment `use_container_width` deprecation sections
- Include backward compatibility language

**For modernizing existing height parameter**:

- Use "modernizing existing parameters" sections
- Keep deprecation sections commented out (no deprecation exists for height)
- Include backward compatibility language

```markdown
## Describe your changes

<!-- For modernizing existing parameters -->

Modernizes `st.{element_name}` {dimension} parameter to use the new `{Dimension}` type system (`"stretch"`, `"content"`, or pixel values) for consistency with other chart elements.

<!-- For new parameters -->
<!-- Adds a new `{dimension}` parameter to `st.{element_name}` using the `{Dimension}` type system (`"stretch"`, `"content"`, or pixel values) for consistency with other chart elements. -->

<!-- For width only: Include deprecation information -->
<!-- This PR also begins the process of deprecating `use_container_width`. The default is updated to `None`, and `width` will be used instead. If the user explicitly passes a value for `use_container_width` then that will take precedence. `use_container_width=True` is equivalent to `width="stretch"` and `use_container_width=False` is equivalent to `width="content"`. The user will be given a warning and suggestion to use `width` instead. We will remove `use_container_width` after 12-31-2025. -->

<!-- Include E2E test snapshots showing visual differences for {dimension}="content", {dimension}="stretch", and {dimension}=400 -->

**Changes Made:**

<!-- For modernizing existing parameters -->

- **Updated parameter signature**: Changed `{dimension}: int | None = None` to `{dimension}: {Dimension} = "stretch"`
  <!-- For new parameters -->
  <!-- - **Added new parameter**: Added `{dimension}: {Dimension} = "stretch"` parameter -->

<!-- For width only: Include deprecation-related changes -->
<!-- - **Deprecated `use_container_width`**: Changed from `bool = True` to `bool | None = None` with deprecation warnings -->

<!-- For modernizing existing parameters -->

- **Preserved backward compatibility**: Existing integer {dimension} values still work
  <!-- For width only: Include use_container_width compatibility -->
  <!-- - **Preserved backward compatibility**: Existing integer width values and `use_container_width` behavior still work -->

- **Added native chart {dimension} support**: When `{dimension}="content"`, respects {library}.{Object}'s native {dimension} if specified (if applicable)
- **Updated layout system**: Uses `LayoutConfig({dimension}={dimension})` instead of direct proto field assignment
- **Enhanced parameter validation**: Validates {dimension} parameter with appropriate error messages

**Key Implementation Details:**

<!-- For modernizing existing parameters -->

_{Dimension} Parameter Modernization:_

- **Breaking change**: Default changes from `{dimension}=None` to `{dimension}="stretch"`
- **Native {dimension} support**: `{dimension}="content"` extracts {dimension} from native chart object if available, falls back to `"stretch"` (if applicable)

<!-- For new parameters -->
<!--
_{Dimension} Parameter Addition:_

- **New functionality**: Adds `{dimension}` parameter with default `{dimension}="stretch"`
- **Native {dimension} support**: `{dimension}="content"` extracts {dimension} from native chart object if available, falls back to `"stretch"` (if applicable)
-->

<!-- For width only: Include backward compatibility & deprecation details -->
<!--
_Backward Compatibility & Deprecation:_

**Deprecation Timeline:** `use_container_width` will be removed after 12-31-2025.

**Parameter Precedence:** If user explicitly passes `use_container_width`, it takes precedence over `width`:

- `use_container_width=True` → `width="stretch"` (overrides width parameter)
- `use_container_width=False` → `width="content"` (overrides width parameter)

**Intelligent Fallback:** When `use_container_width=False` with existing integer widths:

- `use_container_width=False` + `width=400` → `width=400` (preserves integer)
- `use_container_width=False` + `width="content"` → `width="content"`
- `use_container_width=False` + `width="stretch"` → `width="content"` (fallback)

**User Experience:** Users receive deprecation warnings with suggestions to use `width` parameter instead.
-->

## GitHub Issue Link (if applicable)

## Testing Plan

<!-- For new parameters -->

- [ ] Unit Tests (Python) - New {dimension} parameter functionality
  <!-- For modernizing existing parameters -->
  <!-- - [ ] Unit Tests (Python) - Updated {dimension} parameter functionality and backward compatibility -->

<!-- For width only: Include deprecation testing -->
<!-- - [ ] Unit Tests (Python) - `use_container_width` backward compatibility with deprecation warnings -->

- [ ] Unit Tests (Python) - Native chart {dimension} extraction (if applicable)
- [ ] E2E Tests - Visual {dimension} behavior across different values ({dimension}="content", {dimension}="stretch", {dimension}=400)
- [ ] Manual testing completed for all {dimension} scenarios

**Screenshots/Demos:**
_(E2E test snapshots will show visual differences for {dimension}="content", {dimension}="stretch", and {dimension}=400)_

**Additional Notes:**

<!-- For modernizing existing parameters -->

This follows the established pattern from other chart elements. Part of the broader AdvancedLayouts initiative to provide consistent {dimension} APIs across all chart elements.

<!-- For new parameters -->
<!-- This extends the AdvancedLayouts initiative by adding {dimension} support to `st.{element_name}`, bringing it in line with other chart elements that support the `{Dimension}` type system. -->

---

**Contribution License Agreement**

By submitting this pull request you agree that all contributions to this project are made under the Apache 2.0 license.
```

## Required Labels

All Streamlit PRs must have the following labels applied:

### 1. Security Assessment

- `security-assessment-completed` - Required for all PRs

### 2. Impact Classification

Choose **one**:

- `impact:users` - Changes will affect behavior for users
- `impact:internal` - Changes will not affect user behavior

### 3. Change Type

Choose **one**:

- `change:feature` - Feature changes or additions
- `change:bugfix` - Bug fixes
- `change:chore` - Small changes for repo maintenance
- `change:refactor` - Refactoring changes to improve code quality
- `change:other` - Things that don't fit other categories

### Example Label Combinations

**For width/height parameter additions:**

- `security-assessment-completed`
- `impact:users` (changes user-facing API)
- `change:feature` (adds new functionality)

**For internal refactoring:**

- `security-assessment-completed`
- `impact:internal` (no user behavior change)
- `change:refactor` (improves code quality)

**For bug fixes:**

- `security-assessment-completed`
- `impact:users` (fixes user-facing issue)
- `change:bugfix` (fixes a bug)

## Best Practices

- Keep PRs focused and atomic
- Write clear commit messages
- Include tests for new functionality
- Update documentation if needed
- Respond promptly to review feedback

## Common Issues and Solutions

- **Branch not up to date**: `git pull origin main` then `git merge main`
- **Merge conflicts**: Resolve conflicts and commit
- **Failed checks**: Check CI/CD pipeline and fix issues
