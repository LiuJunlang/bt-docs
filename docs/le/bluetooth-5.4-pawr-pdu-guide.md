# 蓝牙 5.4 PAwR 协议完整 PDU 交互指南

> 本文档系统梳理蓝牙 5.4 引入的 **PAwR（Periodic Advertising with Responses，带响应的周期性广播）** 机制中涉及的全部 PDU、参数位置及实际应用场景。所有内容基于蓝牙核心规范对 PAwR 的定义，重点澄清 SyncInfo、ACAD、AUX_SYNC_IND 等易混淆概念。

---

## 目录

1. [PAwR 核心应用场景](#1-pawr-核心应用场景)
2. [PAwR 与标准 Periodic Advertising 的区别](#2-pawr-与标准-periodic-advertising-的区别)
3. [完整 PDU 交互时序](#3-完整-pdu-交互时序)
4. [阶段一：建立同步（Extended Advertising）](#4-阶段一建立同步extended-advertising)
5. [阶段二：子事件交互（PAwR 周期广播）](#5-阶段二子事件交互pawr-周期广播)
6. [关键参数位置总表](#6-关键参数位置总表)
7. [实际场景映射：电子货架标签（ESL）](#7-实际场景映射电子货架标签esl)
8. [常见误区澄清](#8-常见误区澄清)

---

## 1. PAwR 核心应用场景

PAwR 的设计目标是 **"无需建立 ACL 连接的大规模双向广播网络"**。一个 Broadcaster（中心网关）即可管理数千个 Observer（终端节点）。

| 场景 | 说明 | 典型规模 |
|------|------|---------|
| **电子货架标签（ESL）** | 超市/仓库中成千上万个电子价签，中心控制器统一下发价格/促销信息，价签回传电量、状态等 | 数千个 |
| **大规模传感器网络** | 成百上千个传感器节点，中心节点周期性广播采集指令，传感器在指定时隙回传数据 | 数百~数千个 |
| **资产追踪标签** | 仓库中大量标签接收广播指令并回传位置/状态 | 数百~数千个 |

**关键优势**：
- 无需建立 GATT 连接
- 超低功耗（Observer 仅在属于自己的 Subevent 前唤醒）
- 天然 TDMA 响应时隙，避免碰撞

---

## 2. PAwR 与标准 Periodic Advertising 的区别

| 特性 | 标准 Periodic Advertising | PAwR（Periodic Advertising with Responses） |
|------|--------------------------|-------------------------------------------|
| 建立广播 | `ADV_EXT_IND` → `AUX_ADV_IND`（含 SyncInfo） | `ADV_EXT_IND` → `AUX_ADV_IND`（含 SyncInfo **+ ACAD Timing Info**） |
| 周期性广播 PDU | `AUX_SYNC_IND` | **`AUX_SYNC_SUBEVENT_IND`** |
| 响应 PDU | ❌ 无 | ✅ `AUX_SYNC_SUBEVENT_RSP` |
| 子事件（Subevent） | ❌ 无 | ✅ 有 |
| 响应时隙（Response Slot） | ❌ 无 | ✅ 有 |
| 双向通信 | ❌ 单向广播 | ✅ 广播 + 受控响应 |
| 连接需求 | 无需连接 | 无需连接 |

> **核心区别**：PAwR 不使用 `AUX_SYNC_IND`。`AUX_SYNC_IND` 是标准 Periodic Advertising 的周期性广播 PDU，而 PAwR 使用专门定义的 `AUX_SYNC_SUBEVENT_IND` 来支持子事件和响应时隙。

---

## 3. 完整 PDU 交互时序

```
═══════════════════════════════════════════════════════════════════════════════
                        PAwR 完整 PDU 交互时序
═══════════════════════════════════════════════════════════════════════════════

阶段一：建立同步（仅一次，或周期性更新）
───────────────────────────────────────────────────────────────────────────────

Broadcaster (Primary PHY)                    Observer (Scanner)
│                                            │
│  ┌─────────────────────────────┐          │
│  │ ADV_EXT_IND                  │          │
│  │ ├─ AdvA: Broadcaster 地址    │          │
│  │ ├─ AdvMode: Non-connectable  │          │
│  │ │   Non-scannable             │          │
│  │ ├─ ADI: Advertising Data ID  │          │
│  │ └─ AuxPtr ───────────────────┼──────────┼──► 指向 Secondary PHY
│  │     (Channel/Offset/Units)   │          │      上的 AUX_ADV_IND
│  └─────────────────────────────┘          │
│                                            │
│              [T_MAFS]                      │
│                                            │
│  ┌─────────────────────────────┐          │
│  │ AUX_ADV_IND (Secondary PHY)│          │
│  │ ├─ AdvA                     │          │
│  │ ├─ ADI                      │          │
│  │ │                            │          │
│  │ ├─ SyncInfo ────────────────┼──────────┼──► 标准 Periodic Adv
│  │ │   syncPacketInterval       │          │      同步信息
│  │ │   syncChannelMap           │          │
│  │ │   syncAdvPhy               │          │
│  │ │   syncAccessAddress        │          │
│  │ │   syncCRCInit              │          │
│  │ │   syncEventCounter         │          │
│  │ │   syncOffset               │          │
│  │ │                            │          │
│  │ ├─ ACAD ────────────────────┼──────────┼──► 【PAwR 特有】
│  │ │   Periodic Advertising     │          │      Response Timing Info
│  │ │   Response Timing Info:    │          │
│  │ │   ├─ subeventInterval      │          │
│  │ │   ├─ numSubevents          │          │
│  │ │   ├─ responseSlotDelay     │          │
│  │ │   ├─ responseSlotSpacing   │          │
│  │ │   └─ numResponseSlots      │          │
│  │ │                            │          │
│  │ └─ AdvData (Service UUID等) │          │
│  └─────────────────────────────┘          │
│                                            │
│                                            │ ◄── Observer 解析 SyncInfo
│                                            │     和 ACAD Timing Info，
│                                            │     建立同步，计算唤醒窗口
│                                            │

阶段二：周期性子事件交互（循环执行）
───────────────────────────────────────────────────────────────────────────────

Broadcaster (Periodic Adv PHY)      Observer A        Observer B
│                                   │                 │
│  ╔═══════════════════════════════════════════════════════════════════════╗
│  ║ 【Event 0】每 syncPacketInterval 重复一次                            ║
│  ╚═══════════════════════════════════════════════════════════════════════╝
│                                   │                 │
│  ├─ Subevent 0 ───────────────────┼─────────────────┤
│  │                                 │                 │
│  │ ┌───────────────────────────┐ │                 │
│  │ │ AUX_SYNC_SUBEVENT_IND     │ │                 │
│  │ │                           │ │                 │
│  │ │ ├─ AdvA: Broadcaster 地址│ │                 │
│  │ │ │                         │ │                 │
│  │ │ ├─ AdvData:              │ │                 │
│  │ │ │   subeventData[0]:     │ │                 │
│  │ │ │   ├─ responseSlotStart=0│─┼──► A 分配到   │
│  │ │ │   ├─ responseSlotCount=1│ │   Slot 0       │
│  │ │ │   └─ data[]: 给 A 的数据│ │                │
│  │ │ │       (如: ESL 价格)   │ │                 │
│  │ │ │                         │ │                 │
│  │ │ │   subeventData[1]:     │ │                 │
│  │ │ │   ├─ responseSlotStart=1│─┼────────────────┼──► B 分配到
│  │ │ │   ├─ responseSlotCount=1│ │                │   Slot 1
│  │ │ │   └─ data[]: 给 B 的数据│ │                │
│  │ │ │       (如: ESL 价格)   │ │                 │
│  │ │ │                         │ │                 │
│  │ │ └─ numResponseSlots = 2  │ │                 │
│  │ └───────────────────────────┘ │                 │
│  │                                 │                 │
│  │  ◄── Response Window ──►       │                 │
│  │                                 │                 │
│  │  ┌────────┬────────┐          │                 │
│  │  │ Slot 0 │ Slot 1 │          │                 │
│  │  │   ▲    │   ▲    │          │                 │
│  │  └───┼────┴───┼────┘          │                 │
│  │      │        │                │                 │
│  ├──────┘        └────────────────┼─────────────────┤
│     │              │              │                 │
│     ▼              ▼              ▼                 ▼
│  ┌───────────────────┐    ┌───────────────────┐
│  │ AUX_SYNC_SUBEVENT_RSP│    │ AUX_SYNC_SUBEVENT_RSP│
│  │                      │    │                      │
│  │ ├─ AdvA: A 的地址   │    │ ├─ AdvA: B 的地址   │
│  │ ├─ AdvData:          │    │ ├─ AdvData:          │
│  │ │   ├─ subevent = 0  │    │ │   ├─ subevent = 0  │
│  │ │   ├─ slot = 0      │    │ │   ├─ slot = 1      │
│  │ │   ├─ data[]:       │    │ │   ├─ data[]:       │
│  │ │   │   ACK+电量80%  │    │ │   │   ACK+电量65%  │
│  │ │   └─ status:Success│    │ │   └─ status:Success│
│  └───────────────────┘    └───────────────────┘
│                                   │                 │
│                                   │                 │
│  ├─ Subevent 1 ───────────────────┼─────────────────┤
│  │  AUX_SYNC_SUBEVENT_IND          │                 │
│  │  ... (给 C/D 的数据)            │                 │
│  │       ▲         ▲               │                 │
│  │    [Slot0]    [Slot1]           │                 │
│  │       │         │               │                 │
│  ├───────┴─────────┴───────────────┴─────────────────┤
│                                   │                 │
│  ╔═══════════════════════════════════════════════════════════════════════╗
│  ║ 【Event 1】下一个 syncPacketInterval 周期...                          ║
│  ╚═══════════════════════════════════════════════════════════════════════╝
│                                   │                 │
│  ... 更多 Event/Subevent 循环     │                 │
│                                   │                 │
│  ╔═══════════════════════════════════════════════════════════════════════╗
│  ║ 未分配到 Slot 的 Observer：保持接收模式(Rx)，但不发送                  ║
│  ║ 已分配的 Observer：在指定 Slot 发送 RSP，然后回到低功耗睡眠             ║
│  ╚═══════════════════════════════════════════════════════════════════════╝
│                                   │                 │
└───────────────────────────────────┴─────────────────┴───────────────────────
```

---

## 4. 阶段一：建立同步（Extended Advertising）

### 4.1 ADV_EXT_IND

| 参数 | 位置 | 说明 |
|------|------|------|
| **AdvA** | 标准字段 | Broadcaster 的蓝牙地址 |
| **AdvMode** | 标准字段 | `0b00` = Non-connectable and non-scannable（PAwR 不需要连接） |
| **ADI** | 标准字段 | Advertising Data ID，用于去重和识别数据集 |
| **AuxPtr** | 标准字段 | 指向 Secondary PHY 上的 `AUX_ADV_IND`，包含通道号、时钟精度、时间偏移 |

> `ADV_EXT_IND` 本身只携带少量信息，真正的同步信息通过 `AuxPtr` 跳转到 Secondary PHY 上的 `AUX_ADV_IND` 获取。

### 4.2 AUX_ADV_IND（Secondary PHY）

`AUX_ADV_IND` 是 PAwR 同步信息的载体，包含三类数据：

#### 4.2.1 SyncInfo（标准 Periodic Advertising 同步信息）

| 参数 | 说明 |
|------|------|
| `syncPacketInterval` | 两个相邻 Periodic Advertising Event 的间隔 |
| `syncChannelMap` | Periodic Advertising 使用的通道映射 |
| `syncAdvPhy` | 使用的 PHY 类型（1M/2M/Coded） |
| `syncAccessAddress` | 访问地址 |
| `syncCRCInit` | CRC 初始值 |
| `syncEventCounter` | 事件计数器 |
| `syncOffset` | 时间偏移 |

> **SyncInfo 中不包含任何 subevent、response slot 相关参数。** 这些是标准结构，所有 Periodic Advertising（包括不带响应的版本）共用。

#### 4.2.2 ACAD（Additional Controller Advertising Data）

**PAwR 特有的 Timing 参数在 ACAD 中，不在 SyncInfo 中。**

| 参数 | 说明 |
|------|------|
| `subeventInterval` | 两个 Subevent 之间的时间间隔 |
| `numSubevents` | 每个 Event 包含多少个子事件 |
| `responseSlotDelay` | `AUX_SYNC_SUBEVENT_IND` 发送后到 **Slot 0** 开始的延迟 |
| `responseSlotSpacing` | 相邻 Response Slot 之间的时间间隔 |
| `numResponseSlots` | 每个 Subevent 包含多少个 Response Slot |

#### 4.2.3 AdvData

| 内容 | 说明 |
|------|------|
| Service UUID 及应用数据 | 由上层 Profile（如 ESL Profile）定义的 Service UUID 和应用数据。PAwR 本身**不定义**特定的 Service UUID |

---

## 5. 阶段二：子事件交互（PAwR 周期广播）

### 5.1 AUX_SYNC_SUBEVENT_IND

这是 PAwR 的核心广播 PDU，**注意：PAwR 不使用 `AUX_SYNC_IND`**。

| 字段 | 说明 |
|------|------|
| **AdvA** | Broadcaster 的蓝牙地址 |
| **AdvData** | 广播数据载荷，包含子事件数据结构和响应时隙信息： |
| ↳ `subeventData[i].responseSlotStart` | 该 Observer 从哪个 Slot 号开始响应 |
| ↳ `subeventData[i].responseSlotCount` | 该 Observer 可以使用**连续多少个** Slot |
| ↳ `subeventData[i].data[]` | **实际应用数据**（如 ESL 价格更新、传感器命令等） |
| ↳ `numResponseSlots` | 本 Subevent 总共开放多少个 Response Slot |

#### 关于 `responseSlotCount`

`responseSlotCount` 表示该 subeventData 条目对应的 Observer 被分配了多少个**连续**的 Response Slot。

| 典型值 | 说明 |
|--------|------|
| **1** | 绝大多数场景（如 ESL 电子价签），一个 RSP PDU 足够装下 ACK + 电量 + 状态 |
| **>1** | 响应数据量较大，一个 `AUX_SYNC_SUBEVENT_RSP` 装不下，需要占用多个 Slot 发送多个 RSP PDU；或规范预留的灵活性 |

> **注意**：PAwR 是广播机制，`AUX_SYNC_SUBEVENT_IND` 没有 ACK，`AUX_SYNC_SUBEVENT_RSP` 也没有 ACK。Observer 发送响应后**不知道自己是否发送成功**，因此不存在基于 ACK 的重传机制。

### 5.2 AUX_SYNC_SUBEVENT_RSP

Observer 在 Broadcaster 指定的 Response Slot 中发送的响应 PDU。

| 字段 | 说明 |
|------|------|
| **AdvA** | Observer 自身的蓝牙地址（让 Broadcaster 知道是谁在响应） |
| **AdvData** | 响应数据载荷，由上层 Profile 定义格式。常见内容： |
| ↳ `subevent` | 响应的 Subevent 编号（应用层字段，用于交叉校验） |
| ↳ `slot` | 响应的 Slot 编号（应用层字段，用于交叉校验） |
| ↳ `data[]` | **实际响应数据**（如 ACK、电量、传感器读数等） |
| ↳ `status` | 响应状态（如成功/失败，由上层 Profile 定义） |

> **注意**：`subevent`、`slot` 和 `status` **不是链路层 PDU 的固有字段**。链路层通过时序即可确定 subevent 和 slot 编号；这些字段是**上层 Profile（如 ESL Profile）在 AdvData 内定义的应用层数据字段**，用于交叉校验和状态反馈。

---

## 6. 关键参数位置总表

| PDU | 数据结构 | 包含的参数 | 作用 |
|-----|---------|-----------|------|
| **ADV_EXT_IND** | AuxPtr | Channel Index, CA, Offset Units, Aux Offset | 指向 Secondary PHY 上的 `AUX_ADV_IND` |
| **AUX_ADV_IND** | **SyncInfo** | `syncPacketInterval`, `syncChannelMap`, `syncAdvPhy`, `syncAccessAddress`, `syncCRCInit`, `syncEventCounter`, `syncOffset` | **标准 Periodic Advertising 同步信息** —— 时间基准 |
| **AUX_ADV_IND** | **ACAD** → Periodic Advertising Response Timing Info | `subeventInterval`, `numSubevents`, `responseSlotDelay`, `responseSlotSpacing`, `numResponseSlots` | **PAwR 特有参数** —— 子事件和响应时隙结构 |
| **AUX_ADV_IND** | AdvData | Service UUID 及应用数据 | 由上层 Profile（如 ESL Profile）定义的数据 |
| **AUX_SYNC_SUBEVENT_IND** | AdvData | `subeventData[i].responseSlotStart`, `subeventData[i].responseSlotCount`, `subeventData[i].data[]`, `numResponseSlots` | 给特定 Observer 的数据 + 响应时隙分配（均在 AdvData 内） |
| **AUX_SYNC_SUBEVENT_RSP** | AdvData（应用层） | `subevent`, `slot`, `data[]`, `status` | Observer 在指定时隙回传数据（以上均为上层 Profile 在 AdvData 中定义的应用层字段） |

---

## 7. 实际场景映射：电子货架标签（ESL）

以下以超市 ESL（Electronic Shelf Label）系统为例，映射 PAwR PDU 的实际意义。

| 时序阶段 | PDU | ESL 场景对应 | 数据示例 |
|----------|-----|-------------|---------|
| 建立同步 | `ADV_EXT_IND` → `AUX_ADV_IND` | 超市网关广播"我有价签更新服务" | — |
| 同步信息 | `SyncInfo` | 网关告诉价签：我每 500ms 广播一次 | `syncPacketInterval = 500ms` |
| PAwR Timing | `ACAD` | 每次广播分 4 个子事件，每个子事件后有 8 个响应时隙 | `numSubevents=4`, `numResponseSlots=8` |
| 子事件广播 | `AUX_SYNC_SUBEVENT_IND` | 网关在第 0 个子事件中广播："价签 A，牛奶改为 ¥12.8；价签 B，面包改为 ¥6.5" | `subeventData[0].data = "A: ¥12.8"`, `subeventData[1].data = "B: ¥6.5"` |
| 响应 Slot 0 | `AUX_SYNC_SUBEVENT_RSP` | 价签 A 回复 | `data = "ACK, 电量 85%, 显示已更新"` |
| 响应 Slot 1 | `AUX_SYNC_SUBEVENT_RSP` | 价签 B 回复 | `data = "ACK, 电量 62%, 显示已更新"` |
| 睡眠 | — | 价签 A/B 回到深度睡眠，等待下一个属于自己的 Subevent | — |

---

## 8. 常见误区澄清

| 误区 | 正确事实 |
|------|---------|
| **PAwR Timing 参数在 SyncInfo 中** | ❌ 错误。SyncInfo 是标准 Periodic Advertising 结构，**PAwR 特有的 subevent/response slot 参数在 `AUX_ADV_IND` 的 ACAD 中**。 |
| **PAwR 使用 `AUX_SYNC_IND`** | ❌ 错误。`AUX_SYNC_IND` 是**标准 Periodic Advertising** 的周期性广播 PDU，PAwR **不使用它**。PAwR 使用 `AUX_SYNC_SUBEVENT_IND`。 |
| **`responseSlotCount > 1` 用于重传** | ❌ 错误。PAwR 是广播机制，**没有 ACK**，Observer 发送 `AUX_SYNC_SUBEVENT_RSP` 后不知道自己是否成功，因此**不存在重传机制**。`responseSlotCount > 1` 通常用于发送多个 RSP PDU（数据量大）或规范灵活性。 |
| **PAwR 需要建立 ACL 连接** | ❌ 错误。PAwR 的核心优势就是**无需建立连接**，Observer 只需同步广播周期即可。 |
| **所有 Observer 同时响应** | ❌ 错误。PAwR 通过 `responseSlotStart` 和 `responseSlotCount` 为每个 Observer 分配**独立的时隙**，天然避免碰撞。 |

---

## 附录：一个 Event 的时间结构

```
├─────────────────────────────────────────────────────────────────────┤
│                              Event                                  │
│  ├─────────────┬─────────────┬─────────────┬─────────────────────┤ │
│  │ Subevent 0  │ Subevent 1  │ Subevent 2  │ ... (numSubevents)  │ │
│  │             │             │             │                     │ │
│  │ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │                     │ │
│  │ │  IND    │ │ │  IND    │ │ │  IND    │ │                     │ │
│  │ └────┬────┘ │ └────┬────┘ │ └────┬────┘ │                     │ │
│  │  [S0] [S1]  │  [S0] [S1]  │  [S0] [S1]  │   ...  (每子事件)   │ │
│  │   ▲    ▲    │   ▲    ▲    │   ▲    ▲    │                     │ │
│  │   R    R    │   R    R    │   R    R    │                     │ │
│  │   ↑    ↑    │   ↑    ↑    │   ↑    ↑    │                     │ │
│  │  ObsA ObsB  │  ObsC ObsD  │  ObsE ObsF  │                     │ │
│  └─────────────┴─────────────┴─────────────┴─────────────────────┘ │
│                                                                     │
│  ←────────── syncPacketInterval ──────────→                          │
│                                                                     │
│  ←── subeventInterval ──→（Subevent 之间）                           │
│                                                                     │
│  IND ──→ Slot0 的延迟 = responseSlotDelay                            │
│  SlotN ──→ SlotN+1 的间隔 = responseSlotSpacing                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

> 本文档基于蓝牙核心规范 5.4 及后续版本对 PAwR 的定义整理。如有规范更新，请以最新版本为准。
