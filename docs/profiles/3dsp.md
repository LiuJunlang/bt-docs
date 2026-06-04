# 蓝牙 3DSP 深度解析：3D Synchronization Profile 全栈剖析

> **Bluetooth 3D Synchronization Profile（3DSP）** 是 Bluetooth SIG 制定的一项应用层规范（v1.0.3，已 Withdrawn），用于通过蓝牙无线技术实现 3D 显示设备（3DD）与一副或多副 3D 眼镜（3DG）之间的帧同步。本文基于 3DSP v1.0.3 规范原文，从协议栈、消息格式、HCI 命令到设计哲学进行全面拆解。

---

## 目录

1. [概述](#1-概述)
2. [系统角色](#2-系统角色)
3. [核心架构](#3-核心架构)
4. [Proximity Association：邻近关联](#4-proximity-association邻近关联)
5. [Sync Train：同步列车](#5-sync-train同步列车)
6. [Page Abort 触发机制](#6-page-abort-触发机制)
7. [3D Broadcast：核心广播机制](#7-3d-broadcast核心广播机制)
8. [3D Broadcast Message 格式详解](#8-3d-broadcast-message-格式详解)
9. [3D Communications Channel（可选）](#9-3d-communications-channel可选)
10. [HCI 命令与 Opcode 参考](#10-hci-命令与-opcode-参考)
11. [时序精度要求](#11-时序精度要求)
12. [Dual View Mode（双视图模式）](#12-dual-view-mode双视图模式)
13. [3DG 省电策略](#13-3dg-省电策略)
14. [设计反思：为什么 3DSP 被撤回](#14-设计反思为什么-3dsp-被撤回)
15. [参考](#15-参考)

---

## 1. 概述

3DSP 的全称是 **3D Synchronization Profile**，由 Bluetooth SIG 的 3D Glasses Working Group（3DG WG）制定。

### 核心目标

- 让 3D 显示设备（电视、投影仪、显示器）通过蓝牙向 3D 眼镜广播帧同步时序信号
- 支持一副或多副眼镜同时同步（电影院场景可达 500+ 副）
- 实现 "双视图模式"（Dual View Mode）：同一台电视向两组眼镜推送不同内容

### 规范状态

| 属性 | 值 |
|------|-----|
| 最新版本 | v1.0.3（2015-12-15） |
| 状态 | **Withdrawn（已撤回）** |
| 依赖 Core Spec | v3.0+HS / v4.0 + Addendum 4 |
| 底层技术 | BR/EDR（与 BLE 无关） |

### 适用设备

- **3DD（3D Display）**：3D 电视、投影仪、电脑显示器、数字影院放映机
- **3DG（3D Glasses）**：主动快门式蓝牙 3D 眼镜

---

## 2. 系统角色

| 角色 | 全称 | 功能 | GAP 行为 |
|------|------|------|---------|
| **3DD** | 3D Display | 广播 3D 时序信息 | General Discoverable, Synchronizable Mode |
| **3DG** | 3D Glasses | 接收时序并驱动快门 | Synchronization Establishment, CSB Slave |

### 关键设计：3DG 是 "纯接收端"

3DG 在整个同步流程中**不需要建立 ACL 连接**，仅通过监听广播即可完成同步。只有在可选的 **Association Notification / Battery Level Report** 场景下，才会临时建立 ACL 连接发送一条消息，随后立即断开。

---

## 3. 核心架构

### 协议栈（3DD 侧）

```
┌─────────────────────────────────────────────┐
│  Application: 3DSP Profile                  │
│  · Frame Sync Capture（帧同步捕获）          │
│  · 3D Broadcast Message 组装                 │
│  · Proximity Association 管理                │
├─────────────────────────────────────────────┤
│  Optional: 3D Communications Channel         │
│  · L2CAP Unicast Connectionless Data         │
│  · 3DG Connection Announcement               │
├─────────────────────────────────────────────┤
│  GAP (Mandatory)                             │
│  · General Discoverable Mode                 │
│  · Synchronizable Mode                       │
├─────────────────────────────────────────────┤
│  SDP (Mandatory)                             │
│  · "3D Display" / "3D Glasses" Service Record│
├─────────────────────────────────────────────┤
│  CSB - Connectionless Slave Broadcast        │
│  · CSB Master Operation (3DD)                │
│  · Sync Train (初始同步)                     │
│  · Periodic 3D Broadcast (LT_ADDR=1)         │
├─────────────────────────────────────────────┤
│  BB + RF (Baseband)                          │
│  · Inquiry / Inquiry Scan                    │
│  · Page / Page Scan (仅用于触发 Sync Train)  │
└─────────────────────────────────────────────┘
```

### 设计特点

- **无连接广播架构**：核心同步通过 CSB 完成，不依赖 ACL 连接
- **Piconet 时钟复用**：利用 BR/EDR 主从时钟同步机制实现微秒级精度
- **按需唤醒**：3DD 平时静默，仅在检测到 Page Timeout 时临时发送 Sync Train

---

## 4. Proximity Association：邻近关联

Proximity Association 是 3DG 发现附近 3DD 并选择同步目标的过程。

### 关键结论：仅 Inquiry，不建立连接

```
3DG (Glasses)                     3DD (Display #0..N)
─────────────                     ───────────────────

Step 1: 用户按下 3DG 上的关联按钮

Step 2: 3DG 执行 General Inquiry（持续 5.12s ~ 10.24s）
              │
              ├──── ID ─────► 3DD #0: 回 FHS + EIR (含 3D Information)
              │
              ├──── ID ─────► 3DD #1: 回 FHS + EIR (含 3D Information)
              │
              └──── ID ─────► 3DD #N: 回 FHS + EIR (含 3D Information)

Step 3: 3DG 计算每个 3DD 的 Path Loss
        Path Loss = TX Power (from EIR) - RX Power
        
Step 4: 3DG 选择 Path Loss 最小的 3DD
        （即物理距离最近的设备）

Step 5: Proximity Association 完成
        3DG 已获得：3DD 的 BD_ADDR、蓝牙时钟偏移、Class of Device
```

### EIR 中的 3D Information 数据类型

3DD 在 EIR（Extended Inquiry Response）中携带 `3D Information Data Type`，包含以下关键字段：

| 字段 | 大小 | 说明 |
|------|------|------|
| Manufacturer Specific Data | 6 bytes | Company ID = 0x000F (Broadcom) |
| Multicast Capable TV | 1 bit | 是否支持多眼镜组播 |
| Sending Sync Train | 1 bit | 是否正在发送 Sync Train |
| Path Loss Threshold | 1 byte | 关联距离阈值 (dB) |
| TX Power Level | 1 byte | 发射功率 (dBm) |

### 注意：没有 Page，没有 ACL

Proximity Association **仅通过 Inquiry + EIR 完成**。3DG 不需要 Page 3DD，不需要建立 ACL 连接，不需要 LMP 协商。3DG 只需要从 EIR 中提取 3DD 的地址和时钟信息，用于后续同步到 CSB 广播。

---

## 5. Sync Train：同步列车

Sync Train 是 3DG 获取**初始同步**的关键机制。3DG 需要通过 Sync Train 获得 3DD 的精确蓝牙时钟和 AFH 信道图，才能开始监听周期性的 3D Broadcast。

### Sync Train 是什么包？

**DM3 数据包**，不是 ID 包。

规范 Section 12.2.2：

> "The synchronization train is a periodic sequence of **DM3 packets** sent on specific frequencies."

### 发送参数

| 参数 | 值 | 说明 |
|------|-----|------|
| **频率** | 2402, 2426, 2480 MHz | 3 个固定信道，冗余设计 |
| **包类型** | DM3 | 固定 |
| **LT_ADDR** | 0 | 非分配给 Slave 的地址 |
| **Tsync_train_period** | **80 ms** | 每轮 Sync Train 的周期 |
| **Tsync_packet_period** | 1 slot pair (1.25 ms) | 同一轮 3 个包之间的间隔 |
| **持续时间** | >= 120 秒 | 3DD 只发一段时间，然后停止 |
| **Whitening** | Disabled | 不启用数据白化 |

### Sync Train 的 Payload 内容（28 字节）

| 字段 | 大小 | 内容 |
|------|------|------|
| Current Clock | 4 bytes | 3DD 当前蓝牙时钟 bits[27:0] 快照 |
| Next Beacon Clock | 4 bytes | 下一个 Beacon 传输时刻的时钟 |
| AFH Channel Map | 10 bytes | Beacon 使用的 AFH 信道图 |
| 3DD BD_ADDR | 6 bytes | 3DD 的蓝牙地址 |
| Beacon Interval | 2 bytes | Beacon 间隔（典型值 128 slots = 80ms） |
| Version | 1 byte | 协议版本 |
| Display ID | 1 byte | 0=家用, 1=影院 |

### 3DG 扫描方式

```
3DG 扫描流程：

Channel 2402 ──► 监听 103.75ms ──► 没找到？
Channel 2426 ──► 监听 103.75ms ──► 没找到？
Channel 2480 ──► 监听 103.75ms ──► 没找到？
  │
  ▼ 触发 Page Abort（见第 6 节）来唤醒 3DD
  ▼ 重新轮询扫描
  ▼ 检测到 Sync Train（DM3 @ 2402/2426/2480）
  ▼ 提取 Current Clock + Next Beacon Clock + AFH Map
  ▼ 计算 Beacon 接收参数
  ▼ 开始接收 CSB Beacon（3D Broadcast）
```

3DG 在每信道上持续扫描 **103.75 ms**，轮询 3 个信道直到检测到 Sync Train 或 Host 超时（1-5 秒，因产品型号而异）。

### Sync Train 和 3D Broadcast 的关系

| | Sync Train | 3D Broadcast (Beacon) |
|---|---|---|
| **目的** | 初始同步：获取时钟 + AFH 信息 | 持续同步：获取帧时序参数 |
| **包类型** | DM3 | DM1 |
| **频率** | 3 个固定信道 | AFH 跳频序列 |
| **LT_ADDR** | 0 | **1**（固定） |
| **周期** | 每 80ms 一轮，发 120s 后停止 | 每 50-100ms，**持续不断** |
| **Payload** | 28 bytes（时钟+AFH+地址） | 17 bytes（Frame Sync 参数） |

---

## 6. Page Abort 触发机制

这是 3DSP 最精妙的设计之一：**利用 BR/EDR 标准的 Page Timeout 事件作为带外唤醒信号**。

### 触发流程

```
3DG (Master)                     3DD (Slave)
────────────                     ───────────

Step 1: 3DG 发 Page ID
       ID  ─────────────────►
       
Step 2: 3DD 收到，进入 Slave Response State
        回 Page Response ID
           ◄────────────────  ID
        
Step 3: 3DG Abort（不发 FHS，也不发任何东西）
       [无 FHS]
       
Step 4: 3DD 在 Slave Response State 等待 FHS
        等不到 -> pagerespTO 超时
        
Step 5: 3DD baseband 产生 "Slave Page Response Timeout"
        上报 Host
        
Step 6: 3DD Host 启动 Synchronization Train（>=120s）
```

### 为什么这样设计？

| 设计点 | 说明 |
--------|------|
| **3DG 成本极低** | 只发 1 个 ID 包，收 1 个 Response ID，全程 < 2ms |
| **3DD 行为完全标准** | baseband 按正常 Page 流程走，无需任何非标修改 |
| **无额外信令开销** | 不定义新包类型，复用现有 BR/EDR 机制 |
| **按需唤醒** | 3DD 平时静默不发 Sync Train，只在被触发时才发送 |
| **触发信号的本质** | "一个不完整的 Page 尝试" = 门铃 |

### 3DD 的过滤逻辑

规范 Section 8.4：

> "3DD should ignore Slave Page Response Timeout events if it is **already in Synchronizable mode** or if the **3D Broadcast is inactive**."

- **已在 Synchronizable mode**：已经在发 Sync Train，无需重复触发
- **3D Broadcast inactive**：电视没在播放 3D 内容，发了 Sync Train 也没用，白白耗电占 RF

---

## 7. 3D Broadcast：核心广播机制

3D Broadcast 是 3DSP 的核心同步载体。3DD 通过 **Connectionless Slave Broadcast (CSB)** 周期性地广播 17 字节的 3D Broadcast Message，3DG 接收后据此控制左右快门开关。

### 发送流程（3DD 侧）

```
3DD Host                           3DD Controller
──────────                         ──────────────

· 从视频 TCON 捕获 Frame Sync 信号
· 将 Frame Sync Instant 映射到本地蓝牙时钟
· 计算：Frame Period、Left/Right Shutter Offsets
· 组装 17-byte 3D Broadcast Message
        │
        ▼ HCI_Write_Connectionless_Slave_Broadcast_Data (0x0C76)
        │
        ▼ Controller CSB 引擎缓存数据
        │
        ▼ 每 50-100ms 在 LT_ADDR=1 上发送 DM1
           Payload = 17-byte 3D Broadcast Message
```

### CSB 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| **LT_ADDR** | 1 | 固定使用 LT_ADDR 1 |
| **Broadcast Period** | 50-100 ms | 建议值 |
| **Packet Type** | DM1 | 固定 |
| **Whitening** | Enabled | 基于 3DD 时钟 bits[6:1] |
| **AFH** | 支持 | 信道图通过 Sync Train 告知 3DG |

### 3DG 接收流程

```
3DG 在成功接收 Sync Train 后：

1. 提取 3DD 的蓝牙时钟、AFH Channel Map、Beacon Interval
2. 配置 Controller 进入 CSB Slave 接收模式
3. 按 AFH 序列跳频，监听 LT_ADDR=1 的 DM1 包
4. 收到 DM1 后解析 17-byte payload
5. 提取 Frame Sync Instant 和 Shutter Offsets
6. 用本地蓝牙时钟硬件定时器驱动快门
```

### 3DG 可以 Skip 接收

规范 Section 8.5：

> "3DG may skip receiving 3D Broadcasts to conserve power."

3DG 不必每帧都接收 Broadcast。依靠已知的 Frame Period 和本地蓝牙时钟，3DG 可以跳过若干帧，仅在检测到丢包率 >50% 时才恢复连续接收。

---

## 8. 3D Broadcast Message 格式详解

3D Broadcast Message 是 3DD 周期性广播的 17 字节 Payload（DM1 包的 Payload Body）。

| 字段 | 位置 | 大小 | 值范围 | 说明 |
|------|------|------|--------|------|
| **Frame Sync Instant** | Byte 0 bit 0 ~ Byte 3 bit 2 | 4 bytes | 3DD 蓝牙时钟 bits[27:1] | 帧同步信号上升沿对应的时钟值，LSB = 625 us |
| **Reserved** | Byte 3 bits 3,4,5 | 3 bits | 0 | 保留 |
| **Video Mode** | Byte 3 bit 6 | 1 bit | 0 或 1 | 0=3D Mode, 1=Dual View Mode |
| **Reserved** | Byte 3 bit 7 | 1 bit | 0 | 保留 |
| **Bluetooth Clock Phase** | Bytes 4,5 | 2 bytes | 0-624 | Frame Sync 时刻的微秒相位 (us) |
| **Left Shutter Open Offset** | Bytes 6,7 | 2 bytes | 0-65535 | 左快门打开偏移 (us) |
| **Left Shutter Close Offset** | Bytes 8,9 | 2 bytes | 0-65535 | 左快门关闭偏移 (us) |
| **Right Shutter Open Offset** | Bytes 10,11 | 2 bytes | 0-65535 | 右快门打开偏移 (us) |
| **Right Shutter Close Offset** | Bytes 12,13 | 2 bytes | 0-65535 | 右快门关闭偏移 (us) |
| **Frame Sync Period** | Bytes 14,15 | 2 bytes | 0-40000 | 帧周期 (us) |
| **Frame Sync Period Fraction** | Byte 16 | 1 byte | 0-255 | 帧周期小数部分 (1/256 us) |

### 特殊值

| 值 | 含义 |
|-----|------|
| `0xFFFF` (Left Shutter Open Offset) | 2D 模式，双快门保持打开 |
| Frame Sync Period = 0 | 此时 Left Shutter Open Offset 应为 0xFFFF |

### 时序关系

```
Frame Sync Instant (T_sync)
    │
    ▼
 ───┴───────────────────────────────────────────►
    │
    │<──── t_LO_offset ────>│
    │                       ▼ Left Shutter Open
    │                       │
    │<──── t_LC_offset ────>│
    │                       ▼ Left Shutter Close
    │
    │<──── t_RO_offset ────>│
    │                       ▼ Right Shutter Open
    │
    │<──── t_RC_offset ────>│
    │                       ▼ Right Shutter Close
    │
    │<────────── Frame Period (Tfs) ──────────>│
    │                                          │
    ▼                                          ▼
Next Frame Sync Instant                 Next Frame Sync Instant
```

所有偏移量都相对于 Frame Sync Instant 计算。3DG 利用本地蓝牙时钟 + 这些偏移量，通过硬件定时器精确触发快门。

---

## 9. 3D Communications Channel（可选）

3D Communications Channel 是 3DSP 中**可选**的功能，用于 3DG 向 3DD 发送一条消息：**3DG Connection Announcement**。

### 用途

- **Association Notification**：告知 3DD "我已关联到你"
- **Battery Level Report**：上报眼镜剩余电量

### 传输方式

```
3DG ──► [建立 ACL 连接] ──► [L2CAP Unicast Connectionless Data] 
         ──► 3DG Connection Announcement (3 bytes)
         ──► [断开 ACL 连接]
```

规范 Section 6：

> "The 3DG shall send the 3DG Connection Announcement as **unicast traffic over the connectionless L2CAP data channel**. This Profile does not require encryption of the 3DG Connection Announcement message."

### 消息格式（3 字节）

| 字段 | 位置 | 大小 | 值 | 说明 |
|------|------|------|-----|------|
| **Message Opcode** | Byte 0 | 1 byte | 0x00 | 固定为 3DG Connection Announcement |
| **Association Notification** | Byte 1 bit 0 | 1 bit | 0/1 | 1=因关联而发送 |
| **User Request for Battery Level Display** | Byte 1 bit 1 | 1 bit | 0/1 | 1=用户主动请求显示电量 |
| **Reserved** | Byte 1 bits 2-7 | 6 bits | 0 | 保留 |
| **Battery Level** | Byte 2 | 1 byte | 0-100 | 电量百分比；255=不支持电量报告 |

### 为什么这是可选的？

3DSP 的核心同步功能（3D Broadcast）**完全不依赖** 3D Communications Channel。即使 3DD 和 3DG 都不支持这条通道，3D 同步依然可以正常工作。它的存在只是为了提供更好的用户体验（显示已连接眼镜数量、显示电量等）。

---

## 10. HCI 命令与 Opcode 参考

3DSP 依赖的 HCI 命令属于 **BR/EDR Link Control** 和 **Host Controller & Baseband** 命令组。

### CSB 相关命令

| 命令名称 | Opcode | OGF | OCF | 作用 |
|---------|--------|-----|-----|------|
| `Set_Connectionless_Slave_Broadcast` | `0x0441` | `0x01` | `0x041` | 使能/配置 CSB 发送（3DD 用） |
| `Set_Connectionless_Slave_Broadcast_Receive` | `0x0442` | `0x01` | `0x042` | 配置 CSB 接收（3DG 用） |
| `Set_Connectionless_Slave_Broadcast_Data` | `0x0C76` | `0x03` | `0x076` | Host 写入 3D Broadcast Message 数据 |

### Sync Train 相关命令

| 命令名称 | Opcode | OGF | OCF | 作用 |
|---------|--------|-----|-----|------|
| `Start_Synchronization_Train` | `0x0443` | `0x01` | `0x043` | 启动 Sync Train 发送（3DD 用） |
| `Receive_Synchronization_Train` | `0x0444` | `0x01` | `0x044` | 启动 Sync Train 接收扫描（3DG 用） |
| `Read_Synchronization_Train_Parameters` | `0x0C77` | `0x03` | `0x077` | 读取 Sync Train 参数 |
| `Write_Synchronization_Train_Parameters` | `0x0C78` | `0x03` | `0x078` | 配置 Sync Train 参数 |

### 典型调用序列（3DD）

```
上电/进入 3D 模式时：

1. HCI_Write_Synchronization_Train_Parameters (0x0C78)
   -> 配置 Sync Train 周期=80ms，持续时间=120s

2. Set_Connectionless_Slave_Broadcast (0x0441)
   -> 使能 CSB，设置 LT_ADDR=1，广播间隔=50-100ms

每帧视频参数变化时：

3. Set_Connectionless_Slave_Broadcast_Data (0x0C76)
   -> 写入 17-byte 3D Broadcast Message
   -> Controller 按 CSB 周期自动广播

被 3DG 触发时：

4. [收到 Slave Page Response Timeout Event]
   -> Start_Synchronization_Train (0x0443)
   -> Controller 开始周期性发送 DM3 Sync Train
```

---

## 11. 时序精度要求

3DSP 对时序同步有**极严格**的要求，因为人眼对快门与画面的错位非常敏感。

### 精度指标

| 参数 | 分辨率 | 精度要求 |
|------|--------|---------|
| **Frame Sync Instant** | 1 us | **+-5 us** |
| **Frame Sync Period** | 1/256 us (~3.9 ns) | **+-1 us** |
| **蓝牙时钟参考** | 625 us/tick | **+-20 ppm** |

### 视觉可接受阈值

规范 Section 9.3：

> "When the synchronization timing error between the 3DD displayed images and the 3DG lens shutters increases beyond **500 us**, this out-of-sync condition becomes visually noticeable to the typical viewer."

**当同步误差超过 500 us 时，人眼就能感觉到不同步。**

### 3DG 的 Fallback 行为

如果 3DG 检测到以下任一情况，必须**打开双快门进入 2D 模式**：

1. 收到的帧率超出支持范围
2. 帧率低于 25 fps
3. 与 3DD 的同步误差超过 500 us
4. 长时间无法收到 3D Broadcast（丢包率 >50%）

---

## 12. Dual View Mode（双视图模式）

Dual View Mode 是 3DSP 中一个非常有意思的特性。

### 概念

> 同一台 3DD 同时向两组 3DG 推送**两个完全不同的 2D 视频流**。

### 应用场景

- 两个人在同一台电视上看**不同的节目**（一人看球赛，另一人看电影）
- 两个人玩同一款游戏，各自拥有**独立的游戏视角**

### 协议实现

3DD 在 3D Broadcast Message 中设置 **Video Mode = 1**，然后：

| 眼镜组 | 使用的偏移量 | 看到的画面 |
|--------|-------------|-----------|
| 组 #1 | Left Shutter Offsets | Video Stream 1 |
| 组 #2 | Right Shutter Offsets | Video Stream 2 |

```
时间轴 ►

3DD 显示:
[A帧]     [B帧]     [A帧]     [B帧]
视频流1   视频流2   视频流1   视频流2

组 #1 眼镜:
[开] [关]  [关] [关]  [开] [关]  [关] [关]
 看A         黑屏        看A         黑屏

组 #2 眼镜:
[关] [关]  [开] [关]  [关] [关]  [开] [关]
 黑屏        看B         黑屏        看B
```

本质上，3DD 把原本用于左/右眼立体视觉的两个时隙，复用为两个独立的 2D 内容通道。3DG 通过物理开关选择观看哪个流（3D / 2D-View 1 / 2D-View 2）。

---

## 13. 3DG 省电策略

3DG 是电池供电设备，功耗是关键设计约束。

### 策略 1：Skip Broadcast 接收

规范明确允许：

> "3DG may skip receiving 3D Broadcasts to conserve power."

3DG 不必每帧都监听 Broadcast。依靠已知的 Frame Period 和本地蓝牙时钟，3DG 可以跳过若干帧，用硬件定时器维持快门同步。只在检测到丢包率过高时才恢复连续接收。

### 策略 2：基于本地时钟的快门驱动

3DG 收到一次 3D Broadcast 后，就掌握了完整的时序参数：

- Frame Sync Instant（参考时钟值）
- Frame Period（精确到 1/256 us）
- Left/Right Shutter Offsets

此后，3DG 完全依靠**本地蓝牙时钟硬件定时器**驱动快门，不需要持续监听空中数据包。

### 策略 3：低功耗 Sync Train 扫描

3DG 只在开机或失步时扫描 Sync Train，扫描成功后就切换到功耗更低的 Beacon 监听模式。

---

## 14. 设计反思：为什么 3DSP 被撤回

### 14.1 设计哲学问题

典型的 Bluetooth Profile（如 A2DP、HFP、HID）应该：

- 只定义**应用层消息格式**和**状态机**
- 依赖**标准的传输层**（L2CAP、RFCOMM、ATT）
- 不绑定底层硬件特性

3DSP 的问题：

- **深度依赖 Controller 特性**：CSB 和 Sync Train 是 Core Spec Addendum 4 的特性，不是标准 BR/EDR 的通用能力
- **Profile 越界**：把本应由 Core Spec 标准化的机制，放到了 Profile 层直接依赖

### 14.2 与 LE Audio 的对比

| 维度 | 3DSP | LE Audio (BIS) |
|------|------|----------------|
| **广播机制** | CSB（Addendum 4，大量芯片不支持） | **ISO 广播**（Core Spec 5.2 原生支持） |
| **同步方式** | Sync Train + 蓝牙时钟快照 | **BIG Sync Info**（标准 PDU） |
| **Profile 边界** | 入侵底层（绑定硬件） | Profile 只定义编解码、控制消息 |
| **互操作性** | 差（各厂商 vendor cmd 差异大） | 好（标准 Controller 统一支持） |

LE Audio 把"广播同步"变成了 **Core Spec 的标准特性**，Profile 只负责应用层。这才是正确的设计方式。

### 14.3 现实落地困难

| 问题 | 说明 |
|------|------|
| **Controller 支持度差** | 大量 2009-2012 年的 BR/EDR 芯片不支持 CSB/Sync Train |
| **厂商实现碎片化** | 各家用 vendor command 搞私有实现，互操作性差 |
| **时序精度挑战** | 标准 HCI 异步延迟无法满足 +-5 us 的精度要求 |
| **市场消亡** | 3D 电视市场在 2015-2017 年基本消失 |

### 14.4 值得借鉴的设计思路

尽管 3DSP 已被撤回，其中几个技术思路仍有价值：

- **基于蓝牙时钟的精确同步**：LE Audio CIS/ISO 流中的 Controller 级时钟同步依然是核心技术
- **一对多广播式同步架构**：类似 Auracast 广播音频的多接收端同步理念
- **利用标准 timeout 事件作为带外信号**：Page abort 触发 Sync Train 是一个非常精巧的 trick
- **双视图模式思路**：利用时序复用将不同内容定向推送到不同接收端，在 AR/VR 场景中可能复现

---

## 15. 参考

| 文档 | 来源 |
|------|------|
| 3D Synchronization Profile v1.0.3 | Bluetooth SIG |
| Bluetooth Core Specification v3.0+HS / v4.0 | Bluetooth SIG |
| Bluetooth Core Specification Addendum 4 | Bluetooth SIG |
| HCI Command Definitions (hciparse GitHub) | github.com/regnirof/hciparse |

---

> **声明**：本文基于 Bluetooth SIG 公开的 3DSP v1.0.3 规范原文进行分析。3DSP 已被 Bluetooth SIG 标记为 Withdrawn，仅供技术考古和学习参考。
