# 蓝牙 PAwR 与 ACAD 深度解析：从 Core Spec 到 ESL Profile

> 本文基于 **Bluetooth Core Specification v5.4**、**Core Specification Supplement** 及 **ESL Profile v1.0** 整理，聚焦 **ACAD（Additional Controller Advertising Data）**、**PAwR（Periodic Advertising with Responses）** 与 **ESL Profile** 的映射机制与交互时序。

---

## 目录

1. [ACAD 是什么](#1-acad-是什么)
2. [ACAD 中的数据类型](#2-acad-中的数据类型)
3. [Periodic Advertising Response Timing Information](#3-periodic-advertising-response-timing-information)
4. [PAwR 三级时间结构](#4-pawr-三级时间结构)
5. [ESL Profile：Group ID / ESL ID 映射算法](#5-esl-profile-group-id--esl-id-映射算法)
6. [ESL Payload 的位置与长度限制](#6-esl-payload-的位置与长度限制)
7. [PAwR 中的连接建立：AUX_CONNECT_REQ](#7-pawr-中的连接建立aux_connect_req)
8. [关键对比总表](#8-关键对比总表)

---

## 1. ACAD 是什么

ACAD（Additional Controller Advertising Data）是 **Common Extended Advertising Payload Format** 中 Extended Header 的**剩余部分**。

### 1.1 基本定义

| 属性 | 说明 |
|------|------|
| **全称** | Additional Controller Advertising Data |
| **位置** | Extended Header 末尾，长度 = Extended Header 总长度 − Flags(1B) − 其他由 flags 指示存在的字段长度之和 |
| **格式** | 标准 AD Structure：`[Length(1B)] [AD Type(1B)] [AD Data(变长)]`，参见 [Vol 3] Part C, Section 11 |
| **关键约束** | **不能跨多个 advertising PDU 分片**，必须始终完整地放在**单个** advertising physical channel PDU 内 |
| **数据流向** | 来自 advertiser 的 **Controller**，供 recipient 的 **Controller** 使用 |

### 1.2 ACAD 与 AdvData 的核心区别

| 对比项 | ACAD | AdvData |
|--------|------|---------|
| **数据来源** | advertiser 的 **Controller** | advertiser 的 **Host** |
| **数据去向** | recipient 的 **Controller** | recipient 的 **Host** |
| **能否分片** | ❌ **不能**，必须单 PDU 完整 | ✅ 可以跨多个 PDU 分片（最大 1650 bytes） |
| **典型内容** | BIGInfo、Channel Map Update、PAwR Timing | Local Name、Service UUID、Flags、Appearance |
| **规范章节** | [Vol 3] Part C, Section 11 | [Vol 3] Part C, Section 11 |

---

## 2. ACAD 中的数据类型

并非所有 AD 类型都能放入 ACAD。根据 **Core Specification Supplement, Part A, Section 1** 的 Table 1.1，ACAD 中**允许使用**的数据类型如下：

| 数据类型 | ACAD 中使用规则 | 说明 |
|---------|----------------|------|
| **Service UUID** | O（可选，可出现多次） | 16/32/128-bit 服务 UUID 列表 |
| **Manufacturer Specific Data** | O（可选，可出现多次） | 厂商自定义数据 |
| **Channel Map Update Indication** | C.1（可选，只能出现一次） | 信道图更新指示，仅用于 `AUX_SYNC_IND` / `AUX_SYNC_SUBEVENT_IND` |
| **BIGInfo** | C.1（可选，只能出现一次） | 广播等时组信息，用于 `AUX_SYNC_IND` |
| **Periodic Advertising Response Timing Information** | **C.1** | **仅用于 `AUX_ADV_IND` 的 ACAD**（PAwR 场景强制，只能出现一次） |

> **注意**：Flags、Local Name、TX Power Level、Appearance、Encrypted Data 等常见 AD 类型在 ACAD 中标记为 **X（Reserved for future use）**，**不能在 ACAD 中使用**。

---

## 3. Periodic Advertising Response Timing Information

这是 ACAD 中专门用于 **PAwR** 的一种 AD Type，**仅出现在 `AUX_ADV_IND` PDU 的 ACAD 字段中**。

### 3.1 位域结构（8 bytes）

| 字段 | 长度 | 取值范围 / 单位 | 含义 |
|------|------|----------------|------|
| **RspAA** | 4 octets | — | **Response Access Address**。Observer 发送响应包时使用的 Access Address。 |
| **numSubevents** | 1 octet | 0x01 ~ 0x80 (1~128) | 每个 **PAwR Event** 包含的 **Subevent** 数量。 |
| **subeventInterval** | 1 octet | 0x06 ~ 0xFF，单位 **1.25 ms**<br>范围：7.5 ms ~ 318.75 ms | 从一个 Subevent 的开始到下一个 Subevent 的开始之间的时间。 |
| **responseSlotDelay** | 1 octet | 0x01 ~ 0xFE，单位 **1.25 ms**<br>范围：1.25 ms ~ 317.5 ms | 从 **Subevent 开始** 到 **第一个 Response Slot 开始** 的延迟。 |
| **responseSlotSpacing** | 1 octet | 0x02 ~ 0xFF，单位 **0.125 ms**<br>范围：0.25 ms ~ 31.875 ms | 相邻两个 Response Slot 开始时刻之间的间隔。 |

> **注意**：Response Slot 的数量（0~255）**不在此结构内广播**。该参数由 **Broadcaster（AP）** 的 Host 通过 HCI 命令 `HCI_LE_Set_Periodic_Advertising_Parameters` 配置给 Controller，Scanner 端无法从 ACAD 中获知。
>
> 这对 Scanner 意味着什么？Scanner 从 ACAD 中可以获得 `subeventInterval`、`responseSlotDelay` 和 `responseSlotSpacing`，理论上可推算每个 Subevent 最多容纳多少 Slot：
>
> ```
> max_possible_slots = floor((subeventInterval − responseSlotDelay) / responseSlotSpacing)
> ```
>
> 但 Broadcaster 实际配置的 `numResponseSlots` 可能远小于这个理论值（0~255 任意），Scanner **无法确定哪些 Slot 编号是有效的**。这是通用 PAwR 的一个固有问题——Scanner 关心的是 "我应该用哪个 Slot 回复"，但 ACAD 没有告知实际开了多少个 Slot。
>
> **ESL Profile 通过 Command Array 动态映射解决了这个问题**（详见 Section 5.3）：Slot 编号由命令在数组中的索引决定，ESL 设备不需要知道全局的 `numResponseSlots`。

### 3.2 出现位置确认

| PDU 类型 | 是否携带该 AD Type | 说明 |
|---------|-------------------|------|
| **`AUX_ADV_IND`** | ✅ **是，且强制** | Core Spec 原文：*"the ACAD field of the AUX_ADV_IND PDUs **shall contain** Periodic Advertising Response Timing Information"* |
| **`AUX_SYNC_IND`** | ❌ **否** | PAwR 场景中 **不出现** 此 PDU；PADVB 场景中也不携带此类型 |
| **`AUX_SYNC_SUBEVENT_IND`** | ❌ **否** | 规范未授权其 ACAD 携带此类型；逻辑上也不需要重复广播静态配置参数 |

---

## 4. PAwR 三级时间结构

PAwR 的时间组织分为三级：

```
┌─────────────────────────────────────────────────────────────┐
│  PAwR Event（周期性广播事件）                                │
│  周期 = Periodic Advertising Interval（7.5 ms ~ 81.91875 s）│
│  每个 Event 包含 N 个 Subevent                               │
├─────────────────────────────────────────────────────────────┤
│  Subevent 0 │ Subevent 1 │ ... │ Subevent N-1               │
│  间隔 = subeventInterval                                     │
├─────────────────────────────────────────────────────────────┤
│  单个 Subevent 内部：                                        │
│  ┌─────────────┐                                            │
│  │ AUX_SYNC_   │ ← Broadcaster 发送（广播命令或连接请求）    │
│  │ SUBEVENT_IND│                                            │
│  └─────────────┘                                            │
│         │                                                    │
│         │ responseSlotDelay                                  │
│         ▼                                                    │
│  ┌─────┬─────┬─────┐                                        │
│  │Slot0│Slot1│ ... │ ← Response Slots                        │
│  └─────┴─────┴─────┘                                        │
│  间隔 = responseSlotSpacing                                  │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 时间参数总表

| 参数 | 范围 | 单位 | 说明 |
|------|------|------|------|
| **Periodic Advertising Interval** | 7.5 ms ~ 81.91875 s | 1.25 ms | PAwR Event 的周期 |
| **numSubevents** | 1 ~ 128 | — | 每 Event 的 Subevent 数 |
| **subeventInterval** | 7.5 ms ~ 318.75 ms | 1.25 ms | 相邻 Subevent 开始间隔 |
| **responseSlotDelay** | 1.25 ms ~ 317.5 ms | 1.25 ms | Subevent 开始到首个 Slot 的延迟 |
| **responseSlotSpacing** | 0.25 ms ~ 31.875 ms | 0.125 ms | 相邻 Slot 开始间隔 |
| **numResponseSlots** | 0 ~ 255 | — | 每 Subevent 的 Response Slot 数（HCI 配置） |
| **T_IFS** | 150 μs | — | 固定帧间间隔 |

### 4.2 约束检查

规范要求：

```
subeventInterval ≥ responseSlotDelay + (numResponseSlots × responseSlotSpacing)
```

否则参数非法。

---

## 5. ESL Profile：Group ID / ESL ID 映射算法

ESL Profile 是首个使用 PAwR 的蓝牙 Profile，定义了设备寻址与 Subevent/Slot 的映射规则。

### 5.1 ESL 地址结构

| 字段 | 长度 | 范围 | 说明 |
|------|------|------|------|
| **Group ID** | 7 bits | 0 ~ 127 | 共 128 个 Group |
| **ESL ID** | 8 bits | 0 ~ 254（单播），0xFF（广播） | 每个 Group 内 255 个单播设备 |
| **ESL ID = 0xFF** | — | — | **广播地址**，不触发响应 |
| **总容量** | — | — | 128 × 255 = **32,640** 个设备 |

### 5.2 Group ID → Subevent 映射（静态直接映射）

```
Subevent Number = Group ID
```

| Group ID | 对应 Subevent |
|---------|--------------|
| 0 | Subevent #0 |
| 1 | Subevent #1 |
| ... | ... |
| 127 | Subevent #127 |

> Group ID 由 AP 在通过 LE ACL 连接配网时，通过 GATT 写入 ESL 设备的 ESL Address 中。

### 5.3 Response Slot 映射（动态映射）

Response Slot **不是**由 ESL ID 直接计算，而是**由 AP 在每次广播的命令数组中的排列顺序动态决定**。

**规则**：

- AP 发送的 `AUX_SYNC_SUBEVENT_IND` 中，ESL Payload 包含一个**命令数组**（Command Array）。
- 数组中**所有命令**都指向**同一个 Group ID**（即同一个 Subevent）。
- 每个命令通过其内部的 ESL ID 字段指向该 Group 中的某个具体设备。
- **Response Slot 编号 = 该命令在数组中的索引位置（从 0 开始）**。

> **设计理由**：这正是为了规避 Section 3.1 中提到的问题——ACAD 不广播 `numResponseSlots`，Scanner 无法自行确定有效的 Slot 范围。ESL Profile 将 Slot 编号与 Command Array 索引绑定后，ESL 设备不需要知道全局的 `numResponseSlots`：它只需要在自己监听的 Subevent 中收到 Payload，找到 ESL ID 对应的数组索引，即可确定回复位置。

### 5.4 映射示例

假设 AP 在 Subevent #1（Group 1）中发送包含 3 条命令的数组：

| 数组索引 | 命令目标 ESL ID | 对应 Response Slot |
|---------|----------------|------------------|
| 0 | ESL ID = 3 | **Slot #0** |
| 1 | ESL ID = 7 | **Slot #1** |
| 2 | ESL ID = 12 | **Slot #2** |

- ESL ID 3 的设备在 **Slot #0** 回复 `AUX_SYNC_SUBEVENT_RSP`
- ESL ID 7 的设备在 **Slot #1** 回复
- ESL ID 12 的设备在 **Slot #2** 回复

### 5.5 特殊情况：同一设备被多次寻址

如果一个 ESL 设备在同一个 Payload 的命令数组中出现多次，该设备使用**最后一次出现**的索引位置对应的 Slot。

### 5.6 伪代码

```c
// 1. Subevent 映射（静态，配网时确定）
uint8_t my_group_id;      // 由 AP 通过 GATT 配置
uint8_t my_subevent = my_group_id;  // 直接相等

// 2. Response Slot 映射（动态，每次接收 Payload 时确定）
uint8_t my_esl_id;
uint8_t my_response_slot = 0xFF;

for (int i = 0; i < num_commands_in_payload; i++) {
    if (command[i].esl_id == my_esl_id) {
        my_response_slot = i;  // 0-based slot = array index
        // 不 break，继续找，以"最后一次匹配"为准
    }
}

if (my_response_slot != 0xFF) {
    transmit_response_at_slot(my_response_slot);
}
```

---

## 6. ESL Payload 的位置与长度限制

### 6.1 为什么是 48 字节？

**48 字节是 ESL Profile 在应用层规定的上限**，不是 Core Spec 的物理上限（物理上限约 249 字节）。

| 考量 | 说明 |
|------|------|
| **单 Subevent 寻址上限** | 48 字节 = 2 字节(AD Length + AD Type envelope) + 1 字节(Group_ID+RFU) + 45 字节命令数组。最小命令 2 字节，最大命令 17 字节。按最小命令算，单包最多约 **22 条命令**。 |
| **加密开销适配** | ESL 强制使用 **Encrypted Advertising Data (EAD)**。EAD 的 AD Structure 包含 1 字节 Length + 1 字节 Type(0x31) + 4 字节 Randomizer + 4 字节 MIC = **10 字节固定开销**。ESL Payload 48 字节，完整 EAD AD Structure 约 **58 字节**，在 LE 1M PHY 下空中时间仅约 **500~600 μs**。 |
| **响应窗口可控** | 如果 Payload 太大，AP 发送时间变长，会挤压 Response Slot 的可用时间，导致 ESL 设备需要更长的接收窗口，增加功耗。 |

### 6.2 ESL Payload 在 PDU 中的位置

**`AUX_SYNC_SUBEVENT_IND` PDU 的 `AdvData` 字段中**，作为 **Encrypted Data AD Type** 的加密 Payload。

```
AUX_SYNC_SUBEVENT_IND PDU
├── Advertising PDU Header (2 bytes)
├── Extended Header (可变长度)
│   ├── Extended Header Length
│   ├── AdvMode
│   ├── Extended Header Flags
│   ├── AdvA (可选)
│   ├── ADI (可选)
│   ├── TxPower (可选)
│   └── ACAD (ESL 场景通常为 0)
│
└── AdvData ← ESL Payload 就在这里
    └── AD Structure: Encrypted Data
        ├── AD Length (1 octet)
        ├── AD Type = 0x31 (1 octet)
        ├── Randomizer (4 bytes)
        ├── Encrypted Payload
        │   ├── AD Length (1 octet)
        │   ├── AD Type (1 octet)
        │   ├── Group_ID + RFU (1 octet)
        │   └── Command TLV Array (≤ 45 octets)
        └── MIC (4 bytes)
```

### 6.3 ESL Payload 结构

| 字段 | 长度 | 说明 |
|------|------|------|
| **AD Length + AD Type** | 2 octets | AD Structure envelope |
| **Group_ID + RFU** | 1 octet | Group_ID (7 bits) + RFU (1 bit, 固定为 0) |
| **Command TLV Array** | ≤ 45 octets | 一个或多个 TLV 格式的命令 |
| **总长度** | ≤ 48 octets | Profile 规定上限（含 AD Structure envelope） |

---

## 7. PAwR 中的连接建立：AUX_CONNECT_REQ

PAwR 支持在 Subevent 中直接发起连接请求，**这是 PAwR 独有的能力，PADVB 不支持**。

### 7.1 发送位置

**`AUX_CONNECT_REQ` 在 Subevent 开头发送，替代本该发送的 `AUX_SYNC_SUBEVENT_IND`**。

> ❌ **错误理解**："在 Response Slot 发送 AUX_CONNECT_REQ" —— Response Slot 是 AP 的**接收窗口**，不是发送窗口。

### 7.2 连接建立时序

| 步骤 | 动作 | 说明 |
|------|------|------|
| 1 | AP 在 Subevent 开头发送 `AUX_CONNECT_REQ` | 替代 `AUX_SYNC_SUBEVENT_IND`，目标地址为特定 ESL |
| 2 | 目标 ESL **T_IFS（150μs）后立即回复** `AUX_CONNECT_RSP` | **不等待 Response Slot** |
| 3 | 连接建立 | AP 成为 Central，ESL 成为 Peripheral |
| 4 | PAwR 广播继续 | AP 的 PAwR 状态机**继续运行**，同时新增 ACL 连接状态机 |

### 7.3 为什么这样设计？

| 传统方式的问题 | PAwR 方案的优势 |
|-------------|---------------|
| 信道冲突：AP 已在主信道发 `ADV_EXT_IND`，再发 `ADV_IND` 会抢占资源 | 利用已有的 Subevent 时隙，无需额外广播 |
| 目标设备不知道在哪：ESL 平时深度睡眠，只在 Subevent 醒来几毫秒 | 在 ESL **已经在监听的时刻**直接发连接请求 |
| 扫描开销：让电池供电的 ESL 做 Scanner 非常耗电 | ESL **不需要扫描**，它本来就在等这个 Subevent |
| 同步丢失风险：ESL 去扫描/连接可能错过自己的 Subevent | 不离开 PAwR 同步状态，连接建立后继续监听 |

### 7.4 ESL Profile 中使用 ACL 连接的场景

| 场景 | 为什么需要 ACL 连接 |
|------|-------------------|
| **配网（Commissioning）** | 新 ESL 首次入网，AP 需通过 GATT 写入 ESL ID、Group ID、密钥 |
| **传图** | 电子价签显示屏更新图片（几 KB ~ 几十 KB），PAwR 的 48 字节 Payload 和周期性间隔不够用 |
| **固件升级** | OTA 需要高吞吐量和可靠传输 |
| **紧急配置** | 需要双向确认的配置操作 |

---

## 8. 关键对比总表

### 8.1 ACAD vs AdvData

| 对比项 | ACAD | AdvData |
|--------|------|---------|
| **数据生产者** | Controller | Host |
| **数据消费者** | Controller | Host |
| **能否跨 PDU 分片** | ❌ 不能 | ✅ 能（最大 1650 bytes） |
| **典型内容** | BIGInfo、Channel Map Update、PAwR Timing | Local Name、Service UUID、Flags |
| **ESL 场景使用** | 通常不使用（ACAD = 0） | 必须存在（Encrypted Data 封装 ESL Payload） |

### 8.2 PAwR vs PADVB

| 对比项 | PADVB（周期性广播无响应） | PAwR（带响应的周期性广播） |
|--------|------------------------|--------------------------|
| **方向** | 单向：Broadcaster → Observer | 双向：Broadcaster ↔ Observer |
| **同步信息位置** | `AUX_ADV_IND` 的 SyncInfo | `AUX_ADV_IND` 的 SyncInfo **+ ACAD** |
| **Subevent** | 无 | 有（1~128 个 per Event） |
| **Response Slot** | 无 | 有（0~255 个 per Subevent） |
| **连接建立** | ❌ 不支持 | ✅ 支持（`AUX_CONNECT_REQ`） |
| **PAST 支持** | 可选 | **强制** |
| **应用数据变化频率** | 偶尔变化 | 频繁变化 |
| **数据投递** | 所有 Observer 收到相同数据 | 不同 Observer 可收到不同数据 |

### 8.3 AUX_CONNECT_REQ 时序对比

| 场景 | Subevent 开头 | Subevent 中间（responseSlotDelay 后） |
|------|-------------|-----------------------------------|
| **正常命令交互** | `AUX_SYNC_SUBEVENT_IND`（AP 发命令） | Response Slot #0, #1, #2...（ESL 回 `AUX_SYNC_SUBEVENT_RSP`） |
| **建立连接** | `AUX_CONNECT_REQ`（AP 发连接请求） | ESL **立即**回 `AUX_CONNECT_RSP`（不等待 Response Slot） |

### 8.4 ESL Profile 关键数值

| 参数 | 数值 | 说明 |
|------|------|------|
| **Group ID 范围** | 0 ~ 127 | 共 128 个 Group = 128 个 Subevent |
| **ESL ID 范围** | 0 ~ 254（单播），0xFF（广播） | 每个 Group 内 255 个单播设备 |
| **网络总容量** | 32,640 | 128 × 255 |
| **ESL Payload 上限** | 48 bytes | Profile 规定 |
| **单 Subevent 最大命令数** | ~22 | 受 48 字节 Payload 限制 |
| **单 Subevent 实际 Response Slot 数** | ≤ 22（通常） | 由 PAwR 参数配置，但受命令数限制 |
| **最小命令长度** | 2 bytes | 决定单包可寻址设备数上限 |
| **最大命令长度** | 17 bytes | 单包最多约 2 条命令 |

---

## 附录：规范出处

| 知识点 | 规范来源 |
|--------|---------|
| ACAD 定义与约束 | Core Spec v5.4, Vol 6, Part B, Section 2.3.4.8 |
| ACAD 数据类型授权 | Core Specification Supplement, Part A, Section 1, Table 1.1 |
| Periodic Advertising Response Timing Information 格式 | Core Specification Supplement, Part A, Section 1.24 |
| PAwR Event/Subevent/Response Slot 时序 | Core Spec v5.4, Vol 6, Part B, Section 4.4.2.12 |
| AUX_CONNECT_REQ 机制 | Core Spec v5.4, Vol 6, Part B, Section 4.4.2.12.2 |
| ESL Profile 映射与 Payload | ESL Profile v1.0, Section 5.3.1 |
| ESL Payload 长度与加密 | Bluetooth LE Regulatory Aspects Document, Section 7.6.4 |

---

> **文档版本**：v1.0<br>
> **基于规范**：Bluetooth Core Specification v5.4, Core Specification Supplement, ESL Profile v1.0<br>
> **适用场景**：PAwR 协议分析、ESL Profile 开发、蓝牙链路层调试
