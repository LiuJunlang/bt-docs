---
title: BLE Extended Advertising — 从 HCI 到空口 PDU 的完整映射
description: 深入解析 Legacy / Extended Advertising 中 Adv_Type、Advertising_Event_Properties 与空口 PDU Type 的三层映射关系
---

# BLE Extended Advertising：从 HCI 到空口 PDU 的完整映射

> **适用版本**：Bluetooth Core Specification 5.0 ~ 5.4  
> **关注范围**：LE Legacy Advertising、LE Extended Advertising 的 HCI 配置参数与空口 PDU 的对应关系  
> **目标读者**：蓝牙 Controller 固件开发者、协议栈工程师

---

## 目录

- [一、概念分层：三个 Type 所处位置](#一概念分层三个-type-所处位置)
- [二、Legacy Adv_Type 详解](#二legacy-adv_type-详解)
- [三、Advertising_Event_Properties 详解](#三advertising_event_properties-详解)
- [四、空口 PDU Type 详解](#四空口-pdu-type-详解)
- [五、完整映射关系（核心表格）](#五完整映射关系核心表格)
  - [表 5.1：Legacy Adv_Type → Properties → PDU](#表-51-legacy-adv_type--properties--pdu)
  - [表 5.2：Extended Properties → PDU（bit 4 = 0）](#表-52-extended-properties--pdubit-4--0)
  - [表 5.3：Extended 场景所有 PDU 汇总](#表-53-extended-场景所有-pdu-汇总)
- [六、代码决策流程](#六代码决策流程)
- [七、关键设计原理](#七关键设计原理)
- [附录 A：完整空口 PDU Type 编码表](#附录-a完整空口-pdu-type-编码表)
- [附录 B：Advertising_Event_Properties 完整 Bitmap](#附录-badvertising_event_properties-完整-bitmap)

---

## 一、概念分层：三个 Type 所处位置

在 BLE Advertising 的协议栈中，有三个不同的 "Type" 概念，它们分布在不同的协议层，容易混淆：

```
┌─────────────────────────────────────────────────────┐
│                      HOST                           │
│  ┌─────────────────────────────────────────────┐    │
│  │  Adv_Type (Legacy)                          │    │
│  │  Advertising_Event_Properties (Extended)    │    │
│  │          ↓ HCI                              │    │
│  └─────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────┤
│                    CONTROLLER                        │
│  ┌─────────────────────────────────────────────┐    │
│  │  LL 固件：解析 Properties，构建 PDU Header    │    │
│  │          ↓ RF                                │    │
│  │  空口 PDU Type (4-bit in LL Header)          │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

| 概念 | 所在层级 | 长度 | 作用 |
|---|---|---|---|
| **`Adv_Type`** | HCI (Host → Controller) | 1 byte (0x00~0x04) | Legacy 命令中，Host 告诉 Controller 用什么广播模式 |
| **`Advertising_Event_Properties`** | HCI (Host → Controller) | 2 bytes (bitmap) | Extended 命令中，细粒度属性 bitmap |
| **空口 PDU Type** | LL Header 中 | 4 bit | Controller 在空口包中编码的类型字段，Scanner/Initiator 据此判断包类型 |

**核心原则**：`Advertising_Event_Properties` 是纯 HCI 配置参数，**不会被原样传输到空口**。Controller 负责将其"翻译"成 `AdvMode`（2 bit）、Extended Header Flags（变长）等空口实际编码。

---

## 二、Legacy Adv_Type 详解

`LE Set Advertising Parameters` 命令中的 `Advertising_Type` 字段，取值 0x00 ~ 0x04。

| `Adv_Type` | 含义 | 说明 |
|:---:|:---|:---|
| `0x00` | Connectable undirected | 可连接、可扫描、非定向 |
| `0x01` | Connectable directed (high duty cycle) | 可连接、定向、间隔 ≤ 3.75ms，1.28s 超时 |
| `0x02` | Scannable undirected | 可扫描、不可连接、非定向 |
| `0x03` | Non-connectable, non-scannable undirected | 不可连接、不可扫描、非定向 |
| `0x04` | Connectable directed (low duty cycle) | 可连接、定向、正常间隔 |

---

## 三、Advertising_Event_Properties 详解

`LE Set Extended Advertising Parameters` 命令中的 `Advertising_Event_Properties` 字段，为 16-bit bitmap。

### 核心决策 bit：bit 4

**`bit 4 = 1`**（Use legacy advertising PDUs）是 Legacy PDU 与 Extended PDU 的**总开关**：

- **bit 4 = 1**：走 Legacy 分支，Controller 使用 Legacy PDU（ADV_IND / ADV_DIRECT_IND / ADV_SCAN_IND / ADV_NONCONN_IND），Host 也可通过 Legacy 命令 `LE Set Advertising Parameters` 间接设置此参数
- **bit 4 = 0**：走 Extended 分支，Controller 使用 Extended PDU（ADV_EXT_IND + AUX_xxx_IND），**本文档的核心讨论范围**

### 关键互斥约束

协议中有两对硬性互斥，Controller 收到非法组合必须返回 `Unsupported Feature or Parameter Value (0x11)`：

| 约束 | 条件 | 原因 |
|---|---|---|
| **bit 0 + bit 1 不能同时置 1** | 仅当 bit 4 = 0 时 | Extended PDU 的 `AdvMode` 只有 2 bit，`0b11` 为保留值 |
| **bit 3 必须为 0** | 仅当 bit 4 = 0 时 | Extended Advertising 的两跳架构不支持 High Duty Cycle |

---

## 四、空口 PDU Type 详解

空口 PDU Type 是 BLE Link Layer Header 中的 4-bit 字段（从 Access Address 后第 2 个 byte 的 bit 0~3）。

### Legacy PDU：直接由 PDU Type 区分

PDU Type 的 4 bit 值与 PDU 名称一一对应：

| PDU Type | PDU Name |
|:---:|:---|
| `0b0000` | ADV_IND |
| `0b0001` | ADV_DIRECT_IND |
| `0b0010` | ADV_NONCONN_IND |
| `0b0011` | SCAN_REQ |
| `0b0100` | SCAN_RSP |
| `0b0101` | CONNECT_IND |
| `0b0110` | ADV_SCAN_IND |

### Extended PDU：统一编码 `0b0111`，靠 Channel 区分

**所有 Extended Advertising PDU 共享同一个 PDU Type 值 `0b0111`**（`0b1000` 的 `AUX_CONNECT_RSP` 除外）。具体是哪种 Extended PDU，由 **Physical Channel（Primary/Secondary/Periodic）** 和 Payload 中的 **`AdvMode`** 字段共同决定。

这个设计是对 Legacy 格式的**向后兼容**：`0b0111` 在 BLE 4.x 协议中为保留值，Legacy Scanner 收到后会直接忽略，不会误读。

---

## 五、完整映射关系（核心表格）

### 表 5.1：Legacy Adv_Type → Properties → PDU

> 说明：代码中通常先将 `Adv_Type` 统一转换成 `Advertising_Event_Properties`，再进入统一的决策流程。

| `Adv_Type` | 广播模式 | 转换后的 `Advertising_Event_Properties` | 置位 bit | 空口 PDU | PDU Type | 支持 PHY |
|:---:|:---|:---:|:---|:---:|:---:|:---:|
| `0x00` | Connectable undirected | **`0x0013`** | bit 0, 1, 4 | **ADV_IND** | `0b0000` | LE 1M |
| `0x01` | Connectable directed<br>(high duty cycle) | **`0x001D`** | bit 0, 2, 3, 4 | **ADV_DIRECT_IND** | `0b0001` | LE 1M |
| `0x02` | Scannable undirected | **`0x0012`** | bit 1, 4 | **ADV_SCAN_IND** | `0b0110` | LE 1M |
| `0x03` | Non-connectable<br>non-scannable | **`0x0010`** | bit 4 | **ADV_NONCONN_IND** | `0b0010` | LE 1M |
| `0x04` | Connectable directed<br>(low duty cycle) | **`0x0015`** | bit 0, 2, 4 | **ADV_DIRECT_IND** | `0b0001` | LE 1M |

> **注意**：Legacy PDU **没有 `AdvMode` 字段**，只有 Extended PDU 的 Common Extended Advertising Payload Format 中才包含 `AdvMode`。

---

### 表 5.2：Extended Properties → PDU（bit 4 = 0）

> bit 4 = 0 时，Primary Channel 固定发 **`ADV_EXT_IND`**（PDU Type `0b0111`）。  
> Secondary 上的 PDU 由 bit 0~2 的组合决定。  
> **`AdvMode` 的值由 bit 0 和 bit 1 共同编码**：`AdvMode = bit0 | (bit1 << 1)`。

| Properties (Hex) | 含义 | 置位 bit | Primary PDU | Secondary PDU | **AdvMode** | 交互行为 |
|:---:|:---|:---|:---|:---|:---:|:---|
| `0x0000` | Non-connectable<br>non-scannable | — | ADV_EXT_IND | **AUX_ADV_IND** | `0b00` | 发完即走，不等待任何请求 |
| `0x0001` | Connectable | bit 0 | ADV_EXT_IND | **AUX_ADV_IND** | `0b01` | 等待 **AUX_CONNECT_REQ**，回 **AUX_CONNECT_RSP** |
| `0x0002` | Scannable | bit 1 | ADV_EXT_IND | **AUX_ADV_IND** | `0b10` | 等待 **AUX_SCAN_REQ**，回 **AUX_SCAN_RSP** |
| `0x0005` | Directed<br>connectable | bit 0, 2 | ADV_EXT_IND | **AUX_ADV_IND**<br>(含 TargetA) | `0b01` | 仅匹配 TargetA 的 Initiator 可发 **AUX_CONNECT_REQ** |
| `0x0006` | Directed<br>scannable | bit 1, 2 | ADV_EXT_IND | **AUX_ADV_IND**<br>(含 TargetA) | `0b10` | 仅匹配 TargetA 的 Scanner 可发 **AUX_SCAN_REQ** |
| `0x0020` | Anonymous | bit 5 | ADV_EXT_IND | **AUX_ADV_IND**<br>(不含 AdvA) | 依 bit0/1 | Extended Header 省略 AdvA |
| `0x0040` | Include TxPower | bit 6 | ADV_EXT_IND | **AUX_ADV_IND**<br>(含 TxPower) | 依 bit0/1 | Extended Header 含 TxPower |

> **非法组合（Controller 必须拒绝）**：
> - `0x0003`（bit 0 + bit 1）：Connectable 与 Scannable 不能共存（AdvMode 无对应编码）
> - 含 bit 3（High Duty Cycle）：Extended 中 bit 3 必须为 0

> **bit 5/6 可与 bit 0~2 组合**：如 `0x0021`（Anonymous + Connectable）不影响 PDU 名称，只改变 Extended Header 内容。

---

### 表 5.3：Extended 场景所有 PDU 汇总

> **规律**：只有 `ADV_EXT_IND` 和 `AUX_ADV_IND` 的 `AdvMode` 由 Host 配置决定，其余 Extended PDU 的 `AdvMode` **固定为 `0b00`**。

| PDU Name | PDU Type | Channel | **AdvMode** | 触发条件 / 说明 |
|:---|:---:|:---|:---:|:---|
| **ADV_EXT_IND** | `0b0111` | Primary Adv | `00` / `01` / `10` | 所有 Extended Advertising 的指示牌，由 Properties 决定 |
| **AUX_ADV_IND** | `0b0111` | Secondary Adv | `00` / `01` / `10` | Extended 主广播，由 Properties 决定 |
| **AUX_SCAN_RSP** | `0b0111` | Secondary Adv | **`00`** | 响应 AUX_SCAN_REQ，§2.3.4.7 |
| **AUX_SYNC_IND** | `0b0111` | Periodic | **`00`** | Periodic Advertising 广播，§2.3.4.8 |
| **AUX_CHAIN_IND** | `0b0111` | Secondary / Periodic | **`00`** | 数据超单 PDU 容量时的链式分片，§2.3.4.6 |
| **AUX_SYNC_SUBEVENT_IND** | `0b0111` | Periodic | **`00`** | PAwR (BLE 5.4) 子事件广播，§2.3.4.10 |
| **AUX_SYNC_SUBEVENT_RSP** | `0b0111` | Periodic | **`00`** | PAwR 子事件响应，§2.3.4.11 |
| **AUX_CONNECT_RSP** | **`0b1000`** | Secondary Adv | **`00`** | 响应 AUX_CONNECT_REQ，§2.3.4.9 |

> **`AUX_CONNECT_RSP` 是唯一使用独立 PDU Type (`0b1000`) 的 Extended PDU**——设计上确保 Initiator 可快速识别连接响应而非其他 Extended PDU，避免在连接建立关键路径上产生歧义。

---

## 六、代码决策流程

以下是 Controller LL 固件中 `Advertising_Event_Properties` → 空口 PDU 的典型决策逻辑（伪代码）：

```c
void send_advertising_pdu(uint16_t props) {
    if (props & (1 << 4)) {
        // =========================================
        // Legacy 分支 (bit 4 = 1)
        // =========================================
        if (props & (1 << 3)) {
            // High duty cycle directed
            pdu_type = ADV_DIRECT_IND;    // 0b0001
        } else if (props & (1 << 2)) {
            // Low duty cycle directed
            pdu_type = ADV_DIRECT_IND;    // 0b0001
        } else if ((props & 0x3) == 0x3) {
            // bits 0+1: Connectable + Scannable
            pdu_type = ADV_IND;           // 0b0000
        } else if (props & (1 << 1)) {
            pdu_type = ADV_SCAN_IND;      // 0b0110
        } else if (props & (1 << 0)) {
            pdu_type = ADV_IND;           // 0b0000
        } else {
            pdu_type = ADV_NONCONN_IND;   // 0b0010
        }
        tx_legacy_pdu(pdu_type);
    } else {
        // =========================================
        // Extended 分支 (bit 4 = 0)
        // =========================================
        
        // 合法性检查
        if ((props & 0x3) == 0x3) {
            // Connectable + Scannable 非法！
            return ERROR_UNSUPPORTED_PARAM;
        }
        if (props & (1 << 3)) {
            // High Duty Cycle 在 Extended 中非法！
            return ERROR_UNSUPPORTED_PARAM;
        }
        
        // 解析 AdvMode = {bit1, bit0}
        uint8_t adv_mode = (props & (1 << 1)) ? 
                          ((props & 1) ? 3 : 2) : 
                          (props & 1);
        // adv_mode: 00=non, 01=connectable, 10=scannable
        
        // Primary Channel: 固定 ADV_EXT_IND
        tx_adv_ext_ind(adv_mode, /* directed = */ props & (1 << 2));
        
        // Secondary Channel: AUX_ADV_IND
        tx_aux_adv_ind(adv_mode, /* directed = */ props & (1 << 2));
        
        // Secondary 后续行为由 AdvMode 决定:
        //   AdvMode=01: 等 AUX_CONNECT_REQ → 回 AUX_CONNECT_RSP
        //   AdvMode=10: 等 AUX_SCAN_REQ   → 回 AUX_SCAN_RSP
        //   AdvMode=00: 发完即走
    }
}
```

---

## 七、关键设计原理

### 7.1 为什么 Extended 不能同时 Connectable + Scannable？

协议中 `AdvMode` 字段只有 2 bit：

| AdvMode | 含义 |
|:---:|:---|
| `0b00` | Non-connectable and non-scannable |
| `0b01` | Connectable（不可扫描） |
| `0b10` | Scannable（不可连接） |
| `0b11` | **Reserved for future use** |

`0b11` 没有定义 "Connectable + Scannable"。这是 BLE 5.0 的**显式设计选择**——将广播角色拆分为单一职责：

- **Secondary PDU 一次只等一种请求**：要么等 `AUX_CONNECT_REQ`（连接），要么等 `AUX_SCAN_REQ`（扫描），避免 Controller 的 Secondary Channel 状态机同时处理两种 incoming request
- **需要双角色？开两个 advertising set**：一个 Connectable，一个 Scannable，或者回落 Legacy `ADV_IND`

### 7.2 为什么 Extended 不能用 High Duty Cycle Directed？

Legacy high duty cycle（≤ 3.75ms 间隔）是单体短间隔轮询 3 个 Primary Channel，而 Extended 是**两跳跨信道精密调度**：

- Secondary 的发射时间由 AUX Pointer 精确预约，无法以 3.75ms 周期跨 37 个 Secondary Channel 密集调度
- LE Coded PHY 下同等数据空中时间增加 8 倍，高频发射会将空口占有率推至不可接受水平
- Initiator 必须完成两跳才能建立连接（ADV_EXT_IND → AUX_ADV_IND → AUX_CONNECT_REQ），3.75ms 内无法优雅完成

BLE 5.0 用 Coded PHY + 37 个 Secondary Channel 提供了更优雅的覆盖方案，不再需要 brute force 补丁。

### 7.3 Scannable Extended 的应用场景

AUX_ADV_IND 可承载最多 1650 字节，但 "能带 ≠ 每次该带"。Scannable 模式的价值是**按需加载**：

- **空口效率**：大量设备同时广播时，只发轻量指示牌，Scanner 主动请求后才触发大数据传输
- **分层广播**：AUX_ADV_IND 只放基础信息（服务 UUID），AUX_SCAN_RSP 放详细数据（实时值、固件版本），Scanner 敲门后再给
- **隐私控制**：敏感数据放在 AUX_SCAN_RSP 中，被动扫描无法获取
- **典型场景**：电子货架标签（ESL）、工业传感器网络 、博物馆导览 Beacon、蓝牙 Mesh 配网

### 7.4 Scanner 自动处理机制（硬件闭环）

从收到 `ADV_EXT_IND` 到发送 `AUX_SCAN_REQ`，**全程由 Controller 硬件自动完成，无需 LL 固件/软件实时干预**：

1. Primary Channel 收到 `ADV_EXT_IND`：AdvMode 在 Primary 已告知，AUX Pointer 精确指定 Secondary 信道与时间
2. LL 固件事前将 AUX_SCAN_REQ 填入 TX Buffer，预配置 Radio 自动切 TX
3. Secondary Channel 上 T_IFS = 150 µs 内，由 Radio 硬件自动完成 RX→TX 切换
4. 发射 AUX_SCAN_REQ 后，LL 固件才被中断唤醒做**事后处理**（解析 AUX_SCAN_RSP、上报 HCI Event）

主流芯片（Nordic nRF52/53 PPI/DPPI、Silabs EFR32 Radio Sequencer、TI CC26xx Radio Doorbell）均以此类硬件机制实现。

---

## 附录 A：完整空口 PDU Type 编码表

| PDU Type | PDU Name(s) | Physical Channel | 方向 | 说明 |
|:---:|:---|:---|:---|:---|
| `0b0000` | **ADV_IND** | Primary Advertising | Advertiser → | Legacy connectable undirected |
| `0b0001` | **ADV_DIRECT_IND** | Primary Advertising | Advertiser → | Legacy connectable directed |
| `0b0010` | **ADV_NONCONN_IND** | Primary Advertising | Advertiser → | Legacy non-conn non-scan |
| `0b0011` | **SCAN_REQ**<br>**AUX_SCAN_REQ** | Primary / Secondary | Scanner → | Legacy / Extended scan request |
| `0b0100` | **SCAN_RSP** | Primary Advertising | Advertiser → | Legacy scan response |
| `0b0101` | **CONNECT_IND**<br>**AUX_CONNECT_REQ** | Primary / Secondary | Initiator → | Legacy / Extended connection request |
| `0b0110` | **ADV_SCAN_IND** | Primary Advertising | Advertiser → | Legacy scannable undirected |
| **`0b0111`** | **ADV_EXT_IND**<br>**AUX_ADV_IND**<br>**AUX_SCAN_RSP**<br>**AUX_SYNC_IND**<br>**AUX_CHAIN_IND**<br>**AUX_SYNC_SUBEVENT_IND**<br>**AUX_SYNC_SUBEVENT_RSP** | Primary / Secondary / Periodic | Advertiser → | **所有 Extended PDU（AUX_CONNECT_RSP 除外）** |
| **`0b1000`** | **AUX_CONNECT_RSP** | Secondary Advertising | Advertiser → | Extended connection response（唯一独立 Type） |

> `0b0011` 和 `0b0101` 在 Legacy 和 Extended 中**复用同一个 PDU Type 编码**，Scanner/Initiator 通过 Channel（Primary/Secondary）区分 Legacy 还是 Extended 版本。

---

## 附录 B：Advertising_Event_Properties 完整 Bitmap

| Bit | 名称 | 置位含义 |
|:---:|:---|:---|
| 0 | **Connectable** | Connectable advertising |
| 1 | **Scannable** | Scannable advertising |
| 2 | **Directed** | Directed advertising（Extended Header 含 TargetA） |
| 3 | **High Duty Cycle** （仅 Legacy bit4=1） | High duty cycle directed connectable (≤ 3.75 ms) |
| 4 | **Use Legacy PDUs** | `1` = Legacy PDU; `0` = Extended PDU |
| 5 | **Anonymous** （仅 Extended bit4=0） | 省略 AdvA |
| 6 | **Include TxPower** （仅 Extended bit4=0） | Extended Header 含 TxPower |
| 7 | **Decision PDUs** （仅 Extended bit4=0） | 使用 AUX_DEC_IND/RSP 机制（LE Audio） |
| 8 | AdvA in Decision PDUs | （LE Audio） |
| 9 | ADI in Decision PDUs | （LE Audio） |
| 10~15 | Reserved | — |
