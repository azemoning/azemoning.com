---
title: "Vim survival guide for Linux admins"
slug: "vim-survival-guide-for-linux-admins"
date: 2022-02-27
category: "Linux"
tags: ["linux", "vim", "editor", "cli"]
readingTime: "6 min read"
excerpt: "The minimum vim knowledge you need to survive on a Linux server. Editing config files without wanting to throw your keyboard."
---

"How do I exit vim?" is the most upvoted Stack Overflow question about a text editor. That should tell you something about vim's user experience. And yet, here I am writing a guide on why you should learn it.

<!-- truncate -->

Because you don't have a choice. vim (or vi) is installed on virtually every Linux server. When you SSH into a production machine to fix a config file at 2 AM, vim is what's there. Not VS Code. Not nano (usually). vim. You can hate it all you want, but you need to be able to open a file, change something, and save it without losing your mind.

The good news: the minimum viable vim knowledge is about 10 commands. You don't need to become a vim power user. You need to survive.

## The thing that trips everyone up

vim starts in Normal mode. You can't type. This is by design, and it's why people panic. Normal mode is for navigating and editing. Insert mode is for typing. They're separate.

The mode is shown at the bottom of the screen. If you don't see `-- INSERT --`, you're in Normal mode.

When in doubt: press `Esc`. This gets you back to Normal mode from anywhere. Mash it a few times if you're not sure.

## Opening a file

```bash
vim /etc/nginx/nginx.conf
```

You're looking at the file. You can't edit it yet.

## The 10 commands you need

**Getting into Insert mode:**

- `i` — start typing before the cursor
- `a` — start typing after the cursor
- `o` — open a new line below and start typing

`i` is the one you'll use most. Press it, type your changes.

**Getting out of Insert mode:**

- `Esc` — back to Normal mode

**Saving and quitting (from Normal mode):**

- `:w` — save
- `:q` — quit
- `:wq` — save and quit
- `:q!` — quit without saving (the panic button)

If you're stuck and nothing makes sense, `Esc` then `:q!` gets you out. Your changes are lost, but you're free.

**Moving around (Normal mode):**

- Arrow keys work (ignore anyone who says you must use hjkl)
- `gg` — go to the top of the file
- `G` — go to the bottom
- `/something` — search for "something"
- `n` — next search result

That's it. You can now open files, navigate, make changes, and save. Everything below is convenience.

## Deleting stuff

- `x` — delete the character under the cursor
- `dd` — delete the entire line
- `dw` — delete a word
- `3dd` — delete 3 lines

`dd` is the one I use constantly. Bad line? `dd`. Gone.

## Copy and paste

- `yy` — copy the current line
- `3yy` — copy 3 lines
- `p` — paste below the cursor

Copy-paste in vim is called "yank and put" for historical reasons. `yy` to yank, `p` to put. It works.

## Search and replace

```vim
:%s/old/new/g
```

Replace "old" with "new" everywhere in the file. The `%` means the whole file. The `g` means every occurrence on each line (not just the first).

To confirm each replacement:

```vim
:%s/old/new/gc
```

It'll ask you (y/n) for each match.

## A real workflow

You need to change the server name in an Nginx config:

1. `vim /etc/nginx/sites-available/mysite`
2. `/server_name` (search for it)
3. `i` (enter insert mode)
4. Make your changes
5. `Esc` (back to normal)
6. `:wq` (save and quit)

That's the whole workflow. Six steps.

## Block editing (the fancy trick)

Comment out 10 lines:

1. `Ctrl+v` for block selection
2. `j` repeatedly (or `10j`) to select lines
3. `I` to insert at the beginning
4. Type `#`
5. `Esc`

The `#` appears on all selected lines at once. This is the one vim trick that actually impresses people.

## Undo

- `u` — undo
- `Ctrl+r` — redo

Vim's undo is powerful. It tracks changes across insertions. `u` multiple times walks back through your editing history.

## A minimal .vimrc

Create `~/.vimrc` on servers you manage regularly:

```
set number
set tabstop=4
set shiftwidth=4
set expandtab
set autoindent
set hlsearch
set ignorecase
set smartcase
syntax on
```

Line numbers, 4-space tabs, syntax highlighting. Makes vim less hostile without changing the behavior.

## The stuff that confuses people

**I'm typing and random things are happening.** You're in Normal mode pressing keys that are commands. `dd` deletes a line, `x` deletes a character. Press `i` first.

**My arrow keys are printing letters.** You might be in a weird mode. `Esc` a few times, then try arrows again. Or use `hjkl` (left, down, up, right).

**I pasted something and the indentation is wrong.** Vim auto-indents when pasting in Insert mode. Use `:set paste` before pasting, then `:set nopaste` after.

**Search highlights won't go away.** Type `:noh` (no highlight).

**I saved a file but it says [readonly].** You opened it without write permissions. Save with `:w!` (force write, if you have sudo) or quit and reopen with `sudo vim`.

## When to use something else

If nano is available and you just need to change one line, use nano. It's simpler. The learning curve is flat.

If you're doing heavy editing (writing code, restructuring a large config), download the file, edit it in your preferred editor, and upload it back.

vim is for when you're on a server and need to make changes now. It's the emergency tool in your toolkit. Learn enough to be fast at the small tasks and you'll never be stuck.

The five commands that matter: `i` to insert, `Esc` to stop, `:wq` to save and quit, `dd` to delete a line, `u` to undo. Everything else you can look up when you need it. Or don't. You can get through an entire career with just those five.
