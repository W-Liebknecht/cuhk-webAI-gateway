# 项目简介与分享文案

这份文案可用于 GitHub About、社群介绍或作品集。发布源码后再使用“已开放源码”的介绍；仓库设置需在 GitHub 单独保存，本文件不会自动修改远端描述、可见性或 Topics。

## GitHub About

Local bridge from CUHK-Shenzhen AI to Codex CLI & Claude Code: browser sessions, local tool execution, and isolated CLI profiles. Experimental developer checkout.

建议 Topics：`codex`、`claude-code`、`llm`、`gateway`、`browser-automation`、`opencli`、`windows`、`cuhk-shenzhen`。

## 中文分享文案

CUHK AI Bridge 已开放源码：把香港中文大学（深圳）的 AI 网页模型接入本地 Codex CLI 和 Claude Code CLI，支持会话复用、本地工具调用和独立配置。已完成真实网页与双 CLI 的部分场景验收。目前提供 Windows 源码安装与依赖准备脚本，需要自己的学校访问权限；欢迎阅读实现、反馈问题和参与贡献。如果对你有帮助，也欢迎 Star。

项目地址：https://github.com/hfp556/cuhk-ai-codex-bridge

## English introduction

CUHK AI Bridge connects the CUHK-Shenzhen AI website to local Codex CLI and Claude Code CLI through OpenCLI and an authenticated Chrome session. It supports persistent conversations, local tool execution, and isolated CLI profiles. Selected scenarios have been verified with real clients and the school website. Windows source setup is available; there is no standalone installer yet. Users need their own authorized access. Feedback and contributions are welcome.

## 作品集表述

设计并实现一个浏览器驱动的本地 AI Gateway，连接 Codex Responses 与 Claude Anthropic Messages 协议的已验收子集。实现持久会话映射、增量提示、工具决策解析与验证、结果续传、独立客户端数据目录和故障恢复；通过模拟契约测试及真实网页/CLI 工具闭环验证。功能范围和限制可从仓库文档审阅。
