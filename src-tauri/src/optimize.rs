use crate::store::now_millis;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const MODULE_ID: &str = "optimize";
const BACKUP_FILE: &str = "optimize-backup.json";
const REQUEST_FILE: &str = "optimize-request.json";
const RESULT_FILE: &str = "optimize-result.json";
const CLI_FLAG: &str = "--qidian-optimize";
const ELEVATE_TIMEOUT_MS: u64 = 60_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Hive {
    Hklm,
    Hkcu,
}

impl Hive {
    fn label(self) -> &'static str {
        match self {
            Hive::Hklm => "HKLM",
            Hive::Hkcu => "HKCU",
        }
    }

    fn tag(self) -> &'static str {
        match self {
            Hive::Hklm => "hklm",
            Hive::Hkcu => "hkcu",
        }
    }
}

struct ValueDef {
    hive: Hive,
    key: &'static str,
    name: &'static str,
    target: u32,
}

struct ItemDef {
    id: &'static str,
    group: &'static str,
    name: &'static str,
    description: &'static str,
    risk: &'static str,
    /// 该策略最早在哪个 Windows 版本构建号上存在；低于此版本写进去也不会被系统读取。
    min_build: u32,
    /// 写入后系统真正采用新策略的时机，展示给用户，避免误以为立刻见效。
    applies: &'static str,
    /// 消费者版本（家庭/专业）上系统允许的最低值；为空表示与 target 相同。
    consumer_target: Option<u32>,
    values: &'static [ValueDef],
}

/// 全部项目都是单个 DWORD 的策略值：写入前记录原值，写入后回读校验，还原时按原样写回或删除。
const ITEMS: &[ItemDef] = &[
    ItemDef {
        id: "telemetry",
        group: "safe",
        name: "限制诊断数据上传",
        description: "把遥测级别设为当前版本允许的最低值：企业/教育版为「安全」，家庭/专业版系统只接受「必需」。",
        risk: "safe",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: Some(1),
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SOFTWARE\Policies\Microsoft\Windows\DataCollection",
            name: "AllowTelemetry",
            target: 0,
        }],
    },
    ItemDef {
        id: "activity-history",
        group: "safe",
        name: "关闭活动历史记录",
        description: "停止向云端上传时间线活动，同时关闭本机活动历史采集。",
        risk: "safe",
        min_build: 10240,
        applies: "重新登录后生效",
        consumer_target: None,
        values: &[
            ValueDef {
                hive: Hive::Hklm,
                key: r"SOFTWARE\Policies\Microsoft\Windows\System",
                name: "PublishUserActivities",
                target: 0,
            },
            ValueDef {
                hive: Hive::Hklm,
                key: r"SOFTWARE\Policies\Microsoft\Windows\System",
                name: "UploadUserActivities",
                target: 0,
            },
        ],
    },
    ItemDef {
        id: "consumer-features",
        group: "safe",
        name: "阻止推荐应用自动安装",
        description: "关闭「消费者体验」自动推送与安装推广应用；已安装的应用不受影响。",
        risk: "safe",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SOFTWARE\Policies\Microsoft\Windows\CloudContent",
            name: "DisableWindowsConsumerFeatures",
            target: 1,
        }],
    },
    ItemDef {
        id: "copilot",
        group: "safe",
        name: "关闭任务栏 Copilot",
        description: "隐藏任务栏 Copilot 入口并关闭其侧边栏；Windows 11 23H2 及以上有效。",
        risk: "safe",
        min_build: 22621,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot",
            name: "TurnOffWindowsCopilot",
            target: 1,
        }],
    },
    ItemDef {
        id: "search-suggestions",
        group: "safe",
        name: "关闭搜索框网络建议",
        description: "搜索不再向微软请求联网建议与热门内容，只搜索本机应用和文件。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"SOFTWARE\Policies\Microsoft\Windows\Explorer",
            name: "DisableSearchBoxSuggestions",
            target: 1,
        }],
    },
    ItemDef {
        id: "advertising-id",
        group: "safe",
        name: "关闭广告 ID",
        description: "禁用用于个性化广告的用户标识，减少跨应用广告追踪。",
        risk: "safe",
        min_build: 10240,
        applies: "立即生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"SOFTWARE\Microsoft\Windows\CurrentVersion\AdvertisingInfo",
            name: "Enabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "start-recommendations",
        group: "safe",
        name: "关闭开始菜单推荐",
        description: "隐藏开始菜单「推荐」区域的个性化建议，已固定与最近使用的应用保留。",
        risk: "safe",
        min_build: 22000,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            name: "Start_IrisRecommendations",
            target: 0,
        }],
    },
    ItemDef {
        id: "lock-screen-notifications",
        group: "safe",
        name: "关闭锁屏应用通知",
        description: "锁屏界面不再显示应用的通知与提醒；解锁后的通知中心不受影响。",
        risk: "safe",
        min_build: 10240,
        applies: "重新登录后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SOFTWARE\Policies\Microsoft\Windows\System",
            name: "DisableLockScreenAppNotifications",
            target: 1,
        }],
    },
    ItemDef {
        id: "recent-docs",
        group: "safe",
        name: "关闭最近文档与跳转列表",
        description: "开始菜单与任务栏不再显示最近打开的文档；「快速访问」里的最近文件也会清空。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[
            ValueDef {
                hive: Hive::Hkcu,
                key: r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
                name: "ShowRecentDocuments",
                target: 0,
            },
            ValueDef {
                hive: Hive::Hkcu,
                key: r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
                name: "ShowRecentInJumpLists",
                target: 0,
            },
        ],
    },
    ItemDef {
        id: "wifi-sense",
        group: "safe",
        name: "关闭 WiFi 感知共享",
        description: "不再把 WiFi 密码分享给联系人，也不自动连接公开热点；参考 Winhance 的 WiFi-Sense 项。",
        risk: "safe",
        min_build: 10240,
        applies: "重新登录后生效",
        consumer_target: None,
        values: &[
            ValueDef {
                hive: Hive::Hklm,
                key: r"Software\Microsoft\PolicyManager\default\WiFi\AllowWiFiHotSpotReporting",
                name: "Value",
                target: 0,
            },
            ValueDef {
                hive: Hive::Hklm,
                key: r"Software\Microsoft\PolicyManager\default\WiFi\AllowAutoConnectToWiFiSenseHotspots",
                name: "Value",
                target: 0,
            },
        ],
    },
    ItemDef {
        id: "error-reporting",
        group: "safe",
        name: "关闭 Windows 错误报告",
        description: "崩溃与错误信息不再自动上报微软；不影响系统正常运行。",
        risk: "safe",
        min_build: 10240,
        applies: "立即生效",
        consumer_target: None,
        values: &[
            ValueDef {
                hive: Hive::Hklm,
                key: r"SOFTWARE\Policies\Microsoft\Windows\Windows Error Reporting",
                name: "Disabled",
                target: 1,
            },
            ValueDef {
                hive: Hive::Hkcu,
                key: r"SOFTWARE\Policies\Microsoft\Windows\Windows Error Reporting",
                name: "Disabled",
                target: 1,
            },
        ],
    },
    ItemDef {
        id: "remote-assistance",
        group: "safe",
        name: "关闭远程协助",
        description: "禁止他人通过远程协助连接本机提供支持，减少被远程入侵的入口。",
        risk: "safe",
        min_build: 10240,
        applies: "立即生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SYSTEM\CurrentControlSet\Control\Remote Assistance",
            name: "fAllowToGetHelp",
            target: 0,
        }],
    },
    ItemDef {
        id: "content-delivery",
        group: "safe",
        name: "关闭推广内容推送",
        description: "关闭“内容交付”，Windows 不再推送促销内容与建议安装的应用。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
            name: "ContentDeliveryAllowed",
            target: 0,
        }],
    },
    ItemDef {
        id: "subscribed-content",
        group: "safe",
        name: "关闭订阅推送",
        description: "关闭微软与合作伙伴的“订阅内容”推送，减少系统内的推广信息。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
            name: "SubscribedContentEnabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "soft-landing",
        group: "safe",
        name: "关闭使用提示",
        description: "关闭“软着陆”体验，系统不再在使用过程中弹窗介绍新功能。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
            name: "SoftLandingEnabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "oem-preinstalled-apps",
        group: "safe",
        name: "关闭 OEM 预装应用",
        description: "防止厂商（OEM）自动向系统推送预装与捆绑应用。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
            name: "OemPreInstalledAppsEnabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "preinstalled-apps",
        group: "safe",
        name: "关闭建议应用安装",
        description: "Windows 不再自动安装“建议应用”；已装应用不受影响。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
            name: "PreInstalledAppsEnabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "silent-installed-apps",
        group: "safe",
        name: "关闭后台静默安装",
        description: "应用不能在后台被静默安装，需要安装时都会先经过你确认。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
            name: "SilentInstalledAppsEnabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "rotating-lock-screen",
        group: "safe",
        name: "关闭锁屏轮播",
        description: "锁屏不再轮播 Windows 聚焦（Spotlight）图片，使用静态背景。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
            name: "RotatingLockScreenEnabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "sound-startup",
        group: "safe",
        name: "关闭开机启动音",
        description: "Windows 开机时不再播放启动提示音；参考 Winhance 的 Sound 优化项。",
        risk: "safe",
        min_build: 17763,
        applies: "下次开机生效",
        consumer_target: None,
        values: &[
            ValueDef {
                hive: Hive::Hklm,
                key: r"Software\Microsoft\Windows\CurrentVersion\Authentication\LogonUI\BootAnimation",
                name: "DisableStartupSound",
                target: 1,
            },
            ValueDef {
                hive: Hive::Hklm,
                key: r"Software\Microsoft\Windows\CurrentVersion\EditionOverrides",
                name: "UserSetting_DisableStartupSound",
                target: 1,
            },
        ],
    },
    ItemDef {
        id: "notif-welcome",
        group: "safe",
        name: "关闭更新后欢迎体验",
        description: "系统更新完成或登录后不再弹出「欢迎体验」介绍页；参考 Winhance 的通知优化项。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
            name: "SubscribedContent-310093Enabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "notif-setup-suggestions",
        group: "safe",
        name: "关闭完成设置建议",
        description: "不再提示「完成设备设置」之类的引导建议，减少通知打扰。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\UserProfileEngagement",
            name: "ScoobeSystemSettingEnabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "notif-tips",
        group: "safe",
        name: "关闭使用提示",
        description: "不再推送「获取使用提示和建议」类通知，界面更安静。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
            name: "SubscribedContent-338389Enabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "notif-pane-suggestions",
        group: "safe",
        name: "关闭通知中心建议",
        description: "通知中心不再显示系统给出的建议卡片，只保留真实通知。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
            name: "SystemPaneSuggestionsEnabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "notif-capability-access",
        group: "safe",
        name: "关闭权限请求通知",
        description: "应用申请摄像头、麦克风等系统权限时不再弹系统级通知（权限本身不受影响）。",
        risk: "safe",
        min_build: 10240,
        applies: "立即生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\Windows.SystemToast.CapabilityAccess",
            name: "Enabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "notif-startup-app",
        group: "safe",
        name: "关闭启动应用通知",
        description: "有应用被加入开机启动项时不再弹「已启动」通知，减少打扰。",
        risk: "safe",
        min_build: 10240,
        applies: "立即生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\Windows.SystemToast.StartupApp",
            name: "Enabled",
            target: 0,
        }],
    },
    ItemDef {
        id: "notif-sound",
        group: "safe",
        name: "关闭通知声音",
        description: "收到通知时不再播放提示音，静音场景更省心；桌面下方横幅仍正常显示。",
        risk: "safe",
        min_build: 10240,
        applies: "立即生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings",
            name: "NOC_GLOBAL_SETTING_ALLOW_NOTIFICATION_SOUND",
            target: 0,
        }],
    },
    ItemDef {
        id: "driver-coinstallers",
        group: "safe",
        name: "禁用驱动配套软件",
        description: "插入新设备时不再自动安装厂商捆绑软件（如打印机工具、外设驱动套件），只装标准驱动；参考 Winhance 的 Driver Co-Installers 项。",
        risk: "safe",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SOFTWARE\Microsoft\Windows\CurrentVersion\Device Installer",
            name: "DisableCoInstallers",
            target: 1,
        }],
    },
    ItemDef {
        id: "update-restart-asap",
        group: "safe",
        name: "关闭更新后尽快重启",
        description: "系统更新安装完成后不再「尽快重启」，避免自动重启打断工作。",
        risk: "safe",
        min_build: 10240,
        applies: "立即生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"Software\Microsoft\WindowsUpdate\UX\Settings",
            name: "IsExpedited",
            target: 0,
        }],
    },
    ItemDef {
        id: "update-autoreboot",
        group: "safe",
        name: "登录时禁止自动重启",
        description: "有用户登录时，Windows 更新不再自动重启电脑，重启前会先等你确认。",
        risk: "safe",
        min_build: 10240,
        applies: "立即生效",
        consumer_target: None,
        values: &[
            ValueDef {
                hive: Hive::Hkcu,
                key: r"SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU",
                name: "NoAutoRebootWithLoggedOnUsers",
                target: 1,
            },
            ValueDef {
                hive: Hive::Hklm,
                key: r"SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU",
                name: "NoAutoRebootWithLoggedOnUsers",
                target: 1,
            },
        ],
    },
    ItemDef {
        id: "delivery-optimization",
        group: "safe",
        name: "关闭更新 P2P 分发",
        description: "Windows 更新不再通过 P2P 从局域网或互联网其他电脑下载，节省带宽与磁盘写入；仍可正常从微软服务器更新。",
        risk: "safe",
        min_build: 10240,
        applies: "立即生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization",
            name: "DODownloadMode",
            target: 99,
        }],
    },
    ItemDef {
        id: "voice-activation",
        group: "safe",
        name: "关闭语音唤醒",
        description: "关闭「嘿 Cortana/语音唤醒」后台监听，应用无法通过语音命令唤醒；麦克风按需使用不受影响。",
        risk: "safe",
        min_build: 10240,
        applies: "重新登录后生效",
        consumer_target: None,
        values: &[
            ValueDef {
                hive: Hive::Hklm,
                key: r"Software\Microsoft\Windows\CurrentVersion\SpeechOneCore\Settings",
                name: "AgentActivationEnabled",
                target: 0,
            },
            ValueDef {
                hive: Hive::Hklm,
                key: r"Software\Microsoft\Windows\CurrentVersion\SpeechOneCore\Settings",
                name: "AgentActivationLastUsed",
                target: 0,
            },
        ],
    },
    ItemDef {
        id: "whole-fs-search",
        group: "safe",
        name: "关闭全盘搜索",
        description: "文件搜索只查已建立索引的位置，不再实时遍历整个磁盘，显著减少磁盘活动；索引外文件仍可手动定位。",
        risk: "safe",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\Explorer\Search\Preferences",
            name: "WholeFileSystem",
            target: 0,
        }],
    },
    ItemDef {
        id: "system-responsiveness",
        group: "advanced",
        name: "提高前台响应优先",
        description: "把系统后台线程可占用的 CPU 时间从 20% 降到 10%，游戏与前台应用响应更跟手；参考 Winhance 的 System Responsiveness 项。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"System\CurrentControlSet\Control\PriorityControl",
            name: "SystemResponsiveness",
            target: 10,
        }],
    },
    ItemDef {
        id: "power-throttling",
        group: "advanced",
        name: "关闭后台电源节流",
        description: "禁止 Windows 对后台进程进行 CPU 节流，满载运行更稳定；笔记本续航会略有下降。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SYSTEM\CurrentControlSet\Control\Power\PowerThrottling",
            name: "PowerThrottlingOff",
            target: 1,
        }],
    },
    ItemDef {
        id: "visual-effects",
        group: "advanced",
        name: "关闭动画特效",
        description: "把视觉效果切换为「最佳性能」：关闭窗口动画、淡入淡出与菜单动画，界面响应立刻变快；参考 WinUtil / Optimizer 的性能优化项。",
        risk: "caution",
        min_build: 10240,
        applies: "重启资源管理器后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects",
            name: "VisualFXSetting",
            target: 2,
        }],
    },
    ItemDef {
        id: "transparency",
        group: "advanced",
        name: "关闭透明与毛玻璃效果",
        description: "关闭任务栏与窗口的透明/毛玻璃（Mica）效果，降低图形渲染负担；Win10/11 通用。",
        risk: "caution",
        min_build: 10240,
        applies: "立即生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hkcu,
            key: r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            name: "EnableTransparency",
            target: 0,
        }],
    },
    ItemDef {
        id: "network-throttling",
        group: "safe",
        name: "关闭网络带宽节流",
        description: "禁止系统为后台任务预留 20% 网络带宽，提升下载与视频加载速度；参考 WinUtil 的网络优化项。",
        risk: "safe",
        min_build: 10240,
        applies: "立即生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SOFTWARE\Policies\Microsoft\Windows\Psched",
            name: "NonBestEffortLimit",
            target: 0,
        }],
    },
    ItemDef {
        id: "svc-diagtrack",
        group: "advanced",
        name: "禁用诊断跟踪服务",
        description: "禁用 DiagTrack（Connected User Experiences and Telemetry）服务，彻底停止遥测后台进程；比策略限制更省资源。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SYSTEM\CurrentControlSet\Services\DiagTrack",
            name: "Start",
            target: 4,
        }],
    },
    ItemDef {
        id: "svc-pcasvc",
        group: "advanced",
        name: "禁用程序兼容性助手",
        description: "禁用 PcaSvc（Program Compatibility Assistant Service），减少程序启动时被它扫描的开销。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SYSTEM\CurrentControlSet\Services\PcaSvc",
            name: "Start",
            target: 4,
        }],
    },
    ItemDef {
        id: "svc-dmwappush",
        group: "advanced",
        name: "禁用设备管理推送服务",
        description: "禁用 dmwappushservice（Device Management WAP Push），停止常驻推送通道，减少后台进程与网络活动。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SYSTEM\CurrentControlSet\Services\dmwappushservice",
            name: "Start",
            target: 4,
        }],
    },
    ItemDef {
        id: "svc-retail-demo",
        group: "advanced",
        name: "禁用零售演示服务",
        description: "禁用 RetailDemo（零售演示）服务，普通家用电脑完全不需要。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SYSTEM\CurrentControlSet\Services\RetailDemo",
            name: "Start",
            target: 4,
        }],
    },
    ItemDef {
        id: "svc-fax",
        group: "advanced",
        name: "禁用传真服务",
        description: "禁用 Fax（传真）服务，不使用传真功能的机器可安全关闭。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SYSTEM\CurrentControlSet\Services\Fax",
            name: "Start",
            target: 4,
        }],
    },
    ItemDef {
        id: "svc-wmp-network",
        group: "advanced",
        name: "禁用媒体网络共享服务",
        description: "禁用 WMPNetworkSvc（Windows Media Player 网络共享），不使用家庭媒体共享可安全关闭。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SYSTEM\CurrentControlSet\Services\WMPNetworkSvc",
            name: "Start",
            target: 4,
        }],
    },
    ItemDef {
        id: "svc-maps-broker",
        group: "advanced",
        name: "禁用地图下载服务",
        description: "禁用 MapsBroker（地图下载）服务，不常用系统地图应用可安全关闭。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SYSTEM\CurrentControlSet\Services\MapsBroker",
            name: "Start",
            target: 4,
        }],
    },
    ItemDef {
        id: "svc-geolocation",
        group: "advanced",
        name: "禁用地理定位服务",
        description: "禁用 lfsvc（地理定位）服务，不依赖定位功能的应用可安全关闭。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SYSTEM\CurrentControlSet\Services\lfsvc",
            name: "Start",
            target: 4,
        }],
    },
    ItemDef {
        id: "svc-cdp",
        group: "advanced",
        name: "禁用连接设备平台",
        description: "禁用 CDPSvc（Connected Devices Platform），停止跨设备同步与周边设备发现；部分同步功能会失效。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SYSTEM\CurrentControlSet\Services\CDPSvc",
            name: "Start",
            target: 4,
        }],
    },
    ItemDef {
        id: "widgets",
        group: "advanced",
        name: "关闭小组件资讯流",
        description: "关闭任务栏小组件与新闻推送；需要天气卡片时可随时还原。",
        risk: "caution",
        min_build: 19041,
        applies: "重新登录后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SOFTWARE\Policies\Microsoft\Dsh",
            name: "AllowNewsAndInterests",
            target: 0,
        }],
    },
    ItemDef {
        id: "recall",
        group: "advanced",
        name: "关闭 Recall 截图索引",
        description: "禁止 Windows 定期截屏并建立可检索的本地索引，仅影响 Copilot+ PC。",
        risk: "caution",
        min_build: 26100,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SOFTWARE\Policies\Microsoft\Windows\WindowsAI",
            name: "DisableAIDataAnalysis",
            target: 1,
        }],
    },
    ItemDef {
        id: "game-dvr",
        group: "advanced",
        name: "关闭游戏栏后台录制",
        description: "关闭 Xbox Game Bar 的后台录制与广播，减少少量 CPU 与磁盘写入；手动录屏仍可使用。",
        risk: "caution",
        min_build: 10240,
        applies: "重启游戏栏后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SOFTWARE\Policies\Microsoft\Windows\GameDVR",
            name: "AllowGameDVR",
            target: 0,
        }],
    },
    ItemDef {
        id: "driver-updates",
        group: "advanced",
        name: "禁止更新自动装驱动",
        description: "Windows 更新不再自动安装新驱动，避免驱动被偷偷覆盖；仍可手动安装厂商驱动。",
        risk: "caution",
        min_build: 10240,
        applies: "重启后生效",
        consumer_target: None,
        values: &[ValueDef {
            hive: Hive::Hklm,
            key: r"SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate",
            name: "ExcludeWUDriversInQualityUpdate",
            target: 1,
        }],
    },
];

/* ── system profile ──────────────────────────────────────────── */

#[derive(Debug, Clone, Default)]
struct SystemProfile {
    build: u32,
    edition: String,
}

#[cfg(windows)]
fn system_profile() -> &'static SystemProfile {
    use std::sync::OnceLock;
    static PROFILE: OnceLock<SystemProfile> = OnceLock::new();
    PROFILE.get_or_init(|| {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        let key = winreg::RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
            .ok();
        let build = key
            .as_ref()
            .and_then(|key| key.get_value::<String, _>("CurrentBuildNumber").ok())
            .or_else(|| {
                key.as_ref()
                    .and_then(|key| key.get_value::<String, _>("CurrentBuild").ok())
            })
            .and_then(|text| text.trim().parse::<u32>().ok())
            .unwrap_or(0);
        let edition = key
            .as_ref()
            .and_then(|key| key.get_value::<String, _>("EditionID").ok())
            .unwrap_or_default();
        SystemProfile { build, edition }
    })
}

#[cfg(not(windows))]
fn system_profile() -> &'static SystemProfile {
    use std::sync::OnceLock;
    static PROFILE: OnceLock<SystemProfile> = OnceLock::new();
    PROFILE.get_or_init(SystemProfile::default)
}

fn is_enterprise_edition(profile: &SystemProfile) -> bool {
    let edition = profile.edition.to_ascii_lowercase();
    edition.contains("enterprise") || edition.contains("education") || edition.contains("server")
}

/// 系统实际采用的目标值；家庭/专业版会把「安全」级遥测强制抬到「必需」。
fn effective_target(item: &ItemDef, value: &ValueDef, profile: &SystemProfile) -> u32 {
    if is_enterprise_edition(profile) {
        return value.target;
    }
    match item.consumer_target {
        Some(consumer) => consumer,
        None => value.target,
    }
}

/// 不适用的项目不写入，并把原因如实返回，避免用户以为点了就一定有效。
fn availability(item: &ItemDef, profile: &SystemProfile) -> Option<String> {
    if !cfg!(windows) {
        return Some("一键优化目前只支持 Windows".to_string());
    }
    if profile.build > 0 && profile.build < item.min_build {
        return Some(format!(
            "需要 Windows Build {} 及以上，当前为 {}",
            item.min_build, profile.build
        ));
    }
    None
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeValueInfo {
    pub hive: String,
    pub path: String,
    pub name: String,
    pub target: u32,
    pub current: Option<u32>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeItem {
    pub id: String,
    pub group: String,
    /// 类别：privacy（隐私与通知）/ performance（性能）/ services（服务）/ updates（更新与安装）。
    pub category: String,
    pub name: String,
    pub description: String,
    pub risk: String,
    pub requires_admin: bool,
    /// applied（与目标值一致）| default（未设置）| custom（被其它程序改过）| unknown
    pub state: String,
    pub backed_up: bool,
    /// 当前系统/版本上是否真的会被系统读取；false 时 UI 应禁用该项。
    pub available: bool,
    pub unavailable_reason: Option<String>,
    /// 写入后真正生效的时机。
    pub applies: String,
    pub values: Vec<OptimizeValueInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeSkip {
    pub id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeOutcome {
    pub changed: Vec<String>,
    pub skipped: Vec<OptimizeSkip>,
    pub message: String,
    pub elevated: bool,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BackupFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    values: BTreeMap<String, BackupValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupValue {
    existed: bool,
    #[serde(default)]
    value: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ElevatedRequest {
    nonce: String,
    base: String,
    mode: String,
    ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ElevatedResult {
    nonce: String,
    ok: bool,
    changed: Vec<String>,
    skipped: Vec<OptimizeSkip>,
    message: String,
}

fn require_installed(base: &Path) -> Result<(), String> {
    if crate::modules::is_installed(base, MODULE_ID) {
        Ok(())
    } else {
        Err("性能优化模块尚未安装".to_string())
    }
}

/* ── backup file ─────────────────────────────────────────────── */

fn backup_path(base: &Path) -> PathBuf {
    base.join(BACKUP_FILE)
}

fn load_backup(base: &Path) -> BackupFile {
    fs::read_to_string(backup_path(base))
        .ok()
        .and_then(|text| serde_json::from_str::<BackupFile>(&text).ok())
        .unwrap_or_default()
}

fn save_backup(base: &Path, backup: &BackupFile) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(backup).map_err(|error| error.to_string())?;
    fs::write(backup_path(base), data).map_err(|error| format!("无法保存优化备份：{error}"))
}

fn backup_key(value: &ValueDef) -> String {
    format!("{}|{}|{}", value.hive.tag(), value.key, value.name)
}

fn backed_up(item: &ItemDef, backup: &BackupFile) -> bool {
    item.values
        .iter()
        .any(|value| backup.values.contains_key(&backup_key(value)))
}

fn find_item(id: &str) -> Option<&'static ItemDef> {
    ITEMS.iter().find(|item| item.id == id)
}

fn normalize_ids(ids: Vec<String>) -> Vec<String> {
    let mut result: Vec<String> = ids
        .into_iter()
        .filter(|id| find_item(id).is_some())
        .collect();
    result.sort();
    result.dedup();
    result
}

fn item_requires_admin(item: &ItemDef) -> bool {
    item.values.iter().any(|value| value.hive == Hive::Hklm)
}

/// 优化项的类别，用于在界面按「隐私 / 性能 / 服务 / 更新」分组浏览。
/// 与前端 `optimizeCategoryFor`、mock 保持一致。
fn item_category(item: &ItemDef) -> &'static str {
    match item.id {
        "telemetry" | "activity-history" | "copilot" | "search-suggestions" | "advertising-id"
        | "start-recommendations" | "lock-screen-notifications" | "recent-docs" | "wifi-sense"
        | "error-reporting" | "remote-assistance" | "voice-activation" | "recall" | "sound-startup" => {
            "privacy"
        }
        id if id.starts_with("notif-") => "privacy",
        "system-responsiveness" | "power-throttling" | "visual-effects" | "transparency"
        | "network-throttling" | "widgets" | "game-dvr" | "whole-fs-search" => "performance",
        id if id.starts_with("svc-") => "services",
        _ => "updates",
    }
}

/* ── registry access ─────────────────────────────────────────── */

#[cfg(windows)]
fn root(hive: Hive) -> winreg::RegKey {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    match hive {
        Hive::Hklm => winreg::RegKey::predef(HKEY_LOCAL_MACHINE),
        Hive::Hkcu => winreg::RegKey::predef(HKEY_CURRENT_USER),
    }
}

#[cfg(windows)]
fn read_value(value: &ValueDef) -> Result<Option<u32>, String> {
    match root(value.hive).open_subkey(value.key) {
        Ok(key) => match key.get_value::<u32, _>(value.name) {
            Ok(current) => Ok(Some(current)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("无法读取 {}：{error}", value.name)),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法打开 {}：{error}", value.key)),
    }
}

#[cfg(not(windows))]
fn read_value(_value: &ValueDef) -> Result<Option<u32>, String> {
    Err("一键优化目前只支持 Windows".to_string())
}

#[cfg(windows)]
fn write_value(value: &ValueDef, target: u32) -> Result<(), String> {
    let (key, _) = root(value.hive)
        .create_subkey(value.key)
        .map_err(|error| format!("无法写入 {}：{}", value.key, reg_error_text(&error)))?;
    key.set_value(value.name, &target)
        .map_err(|error| format!("无法写入 {}：{}", value.name, reg_error_text(&error)))
}

#[cfg(windows)]
fn restore_value(value: &ValueDef, previous: &BackupValue) -> Result<(), String> {
    use winreg::enums::KEY_SET_VALUE;

    if previous.existed {
        let (key, _) = root(value.hive)
            .create_subkey(value.key)
            .map_err(|error| format!("无法写入 {}：{}", value.key, reg_error_text(&error)))?;
        return key
            .set_value(value.name, &previous.value)
            .map_err(|error| format!("无法还原 {}：{}", value.name, reg_error_text(&error)));
    }
    match root(value.hive).open_subkey_with_flags(value.key, KEY_SET_VALUE) {
        Ok(key) => match key.delete_value(value.name) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("无法删除 {}：{}", value.name, reg_error_text(&error))),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法打开 {}：{}", value.key, reg_error_text(&error))),
    }
}

/// 把注册表「拒绝访问」（ERROR_ACCESS_DENIED）翻译成可操作的中文提示，
/// 按当前进程是否已提权区分是「权限不够」还是「被系统/安全软件保护」。
#[cfg(windows)]
fn reg_error_text(error: &std::io::Error) -> String {
    if error.raw_os_error() == Some(5) {
        if is_elevated() {
            "拒绝访问：该项可能被系统策略或安全软件保护，管理员也无法写入；可忽略，或到 Windows 设置中手动调整".to_string()
        } else {
            "拒绝访问：缺少管理员权限，请以管理员身份运行启点后重试".to_string()
        }
    } else {
        error.to_string()
    }
}

#[cfg(not(windows))]
fn reg_error_text(error: &std::io::Error) -> String {
    error.to_string()
}

#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut size = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut std::ffi::c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        )
        .is_ok();
        let _ = CloseHandle(token);
        ok && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

/* ── describe ────────────────────────────────────────────────── */

fn describe(item: &ItemDef, backup: &BackupFile, profile: &SystemProfile) -> OptimizeItem {
    let mut values = Vec::new();
    let mut all_match = true;
    let mut all_missing = true;
    let mut unknown = false;
    for value in item.values {
        let target = effective_target(item, value, profile);
        match read_value(value) {
            Ok(current) => {
                if current != Some(target) {
                    all_match = false;
                }
                if current.is_some() {
                    all_missing = false;
                }
                values.push(OptimizeValueInfo {
                    hive: value.hive.label().to_string(),
                    path: value.key.to_string(),
                    name: value.name.to_string(),
                    target,
                    current,
                    error: None,
                });
            }
            Err(error) => {
                unknown = true;
                all_match = false;
                all_missing = false;
                values.push(OptimizeValueInfo {
                    hive: value.hive.label().to_string(),
                    path: value.key.to_string(),
                    name: value.name.to_string(),
                    target,
                    current: None,
                    error: Some(error),
                });
            }
        }
    }
    let state = if unknown {
        "unknown"
    } else if all_match {
        "applied"
    } else if all_missing {
        "default"
    } else {
        "custom"
    };
    let unavailable_reason = availability(item, profile);
    OptimizeItem {
        id: item.id.to_string(),
        group: item.group.to_string(),
        category: item_category(item).to_string(),
        name: item.name.to_string(),
        description: item.description.to_string(),
        risk: item.risk.to_string(),
        requires_admin: item_requires_admin(item),
        state: state.to_string(),
        backed_up: backed_up(item, backup),
        available: unavailable_reason.is_none(),
        unavailable_reason,
        applies: item.applies.to_string(),
        values,
    }
}

pub fn list(base: &Path) -> Result<Vec<OptimizeItem>, String> {
    require_installed(base)?;
    let backup = load_backup(base);
    let profile = system_profile();
    Ok(ITEMS
        .iter()
        .map(|item| describe(item, &backup, profile))
        .collect())
}

/* ── apply / restore ─────────────────────────────────────────── */

#[cfg(windows)]
fn apply_local(base: &Path, ids: &[String]) -> Result<OptimizeOutcome, String> {
    let profile = system_profile();
    let mut backup = load_backup(base);
    let mut changed = Vec::new();
    let mut skipped = Vec::new();

    for id in ids {
        let Some(item) = find_item(id) else {
            skipped.push(OptimizeSkip {
                id: id.clone(),
                reason: "未知优化项".to_string(),
            });
            continue;
        };

        // 当前系统根本不会读取的策略，直接如实跳过。
        if let Some(reason) = availability(item, profile) {
            skipped.push(OptimizeSkip {
                id: id.clone(),
                reason,
            });
            continue;
        }

        // 先完整读取，任一值读不到就不写入，避免留下半套配置。
        let mut current = Vec::with_capacity(item.values.len());
        let mut failure: Option<String> = None;
        for value in item.values {
            match read_value(value) {
                Ok(existing) => current.push(existing),
                Err(error) => {
                    failure = Some(error);
                    break;
                }
            }
        }
        if let Some(reason) = failure {
            skipped.push(OptimizeSkip {
                id: id.clone(),
                reason,
            });
            continue;
        }

        let targets: Vec<u32> = item
            .values
            .iter()
            .map(|value| effective_target(item, value, profile))
            .collect();

        // 已经等于目标值的项目不再写入，也不虚报“已优化”。
        if current
            .iter()
            .zip(&targets)
            .all(|(existing, target)| *existing == Some(*target))
        {
            skipped.push(OptimizeSkip {
                id: id.clone(),
                reason: "已是目标值，无需改动".to_string(),
            });
            continue;
        }

        // 记录将被改动值的原值；已备份过的保留最早那次的原值。
        let mut inserted = Vec::new();
        for (value, existing) in item.values.iter().zip(&current) {
            let key = backup_key(value);
            if backup.values.contains_key(&key) {
                continue;
            }
            backup.values.insert(
                key.clone(),
                BackupValue {
                    existed: existing.is_some(),
                    value: existing.unwrap_or(0),
                },
            );
            inserted.push(key);
        }

        let mut written: Vec<&ValueDef> = Vec::new();
        let mut write_error: Option<String> = None;
        for ((value, target), existing) in item.values.iter().zip(&targets).zip(&current) {
            if *existing == Some(*target) {
                continue;
            }
            match write_value(value, *target) {
                Ok(()) => written.push(value),
                Err(error) => {
                    write_error = Some(error);
                    break;
                }
            }
        }

        // 写完立刻回读校验：策略值没有真正落到注册表就整项回滚，不报成功。
        if write_error.is_none() {
            for value in written.iter().copied() {
                let target = effective_target(item, value, profile);
                match read_value(value) {
                    Ok(Some(actual)) if actual == target => {}
                    Ok(actual) => {
                        write_error = Some(format!(
                            "{} 写入后校验不一致（期望 {}，读回 {}），已回滚该项",
                            value.name,
                            target,
                            actual
                                .map(|value| value.to_string())
                                .unwrap_or_else(|| "未设置".to_string())
                        ));
                        break;
                    }
                    Err(error) => {
                        write_error = Some(format!("{} 写入后无法回读校验：{error}", value.name));
                        break;
                    }
                }
            }
        }

        if let Some(reason) = write_error {
            // 回滚本项已写入的值，并清掉本次新增的备份记录。
            for value in written.iter().rev().copied() {
                if let Some(previous) = backup.values.get(&backup_key(value)) {
                    let _ = restore_value(value, previous);
                }
            }
            for key in inserted {
                backup.values.remove(&key);
            }
            skipped.push(OptimizeSkip {
                id: id.clone(),
                reason,
            });
            continue;
        }

        changed.push(id.clone());
    }

    backup.version = 1;
    save_backup(base, &backup)?;
    Ok(OptimizeOutcome {
        message: outcome_message("已优化", &changed, &skipped),
        changed,
        skipped,
        elevated: false,
        cancelled: false,
    })
}

#[cfg(not(windows))]
fn apply_local(_base: &Path, _ids: &[String]) -> Result<OptimizeOutcome, String> {
    Err("一键优化目前只支持 Windows".to_string())
}

#[cfg(windows)]
fn restore_local(base: &Path, ids: &[String], all: bool) -> Result<OptimizeOutcome, String> {
    let mut backup = load_backup(base);
    let targets: Vec<String> = if all {
        ITEMS
            .iter()
            .filter(|item| backed_up(item, &backup))
            .map(|item| item.id.to_string())
            .collect()
    } else {
        ids.to_vec()
    };
    let mut changed = Vec::new();
    let mut skipped = Vec::new();

    for id in &targets {
        let Some(item) = find_item(id) else { continue };
        if !backed_up(item, &backup) {
            skipped.push(OptimizeSkip {
                id: id.clone(),
                reason: "这一项没有启点记录的原始值，未做改动".to_string(),
            });
            continue;
        }
        let mut failure: Option<String> = None;
        let mut restored = Vec::new();
        for value in item.values {
            let key = backup_key(value);
            let Some(previous) = backup.values.get(&key).cloned() else {
                continue;
            };
            if let Err(error) = restore_value(value, &previous) {
                failure = Some(error);
                break;
            }
            // 回读确认确实回到了原值（或原值本就不存在而被删除）。
            let verified = match read_value(value) {
                Ok(current) if previous.existed => current == Some(previous.value),
                Ok(current) => current.is_none(),
                Err(_) => false,
            };
            if !verified {
                failure = Some(format!("{} 还原后校验不一致，已保留原值备份", value.name));
                break;
            }
            restored.push(key);
        }
        for key in restored {
            backup.values.remove(&key);
        }
        match failure {
            Some(reason) => skipped.push(OptimizeSkip {
                id: id.clone(),
                reason,
            }),
            None => changed.push(id.clone()),
        }
    }

    save_backup(base, &backup)?;
    Ok(OptimizeOutcome {
        message: outcome_message("已还原", &changed, &skipped),
        changed,
        skipped,
        elevated: false,
        cancelled: false,
    })
}

#[cfg(not(windows))]
fn restore_local(_base: &Path, _ids: &[String], _all: bool) -> Result<OptimizeOutcome, String> {
    Err("一键优化目前只支持 Windows".to_string())
}

fn outcome_message(verb: &str, changed: &[String], skipped: &[OptimizeSkip]) -> String {
    if changed.is_empty() && skipped.is_empty() {
        return "没有需要变更的项目".to_string();
    }
    if changed.is_empty() {
        // 全部被跳过时，把第一个原因直接说出来，而不是含糊地报“跳过 N 项”。
        let reason = skipped
            .first()
            .map(|skip| skip.reason.as_str())
            .unwrap_or("没有项目被改动");
        return format!("没有项目被改动：{reason}");
    }
    let mut text = format!("{verb} {} 项，已回读校验", changed.len());
    if !skipped.is_empty() {
        text.push_str(&format!("；{} 项未改动", skipped.len()));
    }
    text
}

pub fn apply(base: &Path, ids: Vec<String>) -> Result<OptimizeOutcome, String> {
    require_installed(base)?;
    let ids = normalize_ids(ids);
    if ids.is_empty() {
        return Err("未选择任何优化项".to_string());
    }
    let needs_admin = ids
        .iter()
        .filter_map(|id| find_item(id))
        .any(item_requires_admin);
    if needs_admin && !is_elevated() {
        return elevate(base, "apply", &ids);
    }
    apply_local(base, &ids)
}

pub fn restore(base: &Path, ids: Vec<String>, all: bool) -> Result<OptimizeOutcome, String> {
    require_installed(base)?;
    let ids = normalize_ids(ids);
    if !all && ids.is_empty() {
        return Err("未选择需要还原的项目".to_string());
    }
    let needs_admin = ids
        .iter()
        .filter_map(|id| find_item(id))
        .any(item_requires_admin);
    if needs_admin && !is_elevated() {
        return elevate(base, "restore", &ids);
    }
    // 还原全部时，是否提权取决于仍有备份的系统级项目。
    if all && !is_elevated() {
        let backup = load_backup(base);
        let requires = ITEMS
            .iter()
            .filter(|item| backed_up(item, &backup))
            .any(item_requires_admin);
        if requires {
            return elevate(base, "restoreAll", &[]);
        }
    }
    restore_local(base, &ids, all)
}

/// 一键切换公共 DNS：把当前配置备份后写入指定预设（阿里/腾讯/Google/Cloudflare）。
/// 需要管理员权限的操作会走提权 CLI 分支，用户确认 UAC 后由子进程完成。
pub fn dns_set(base: &Path, preset: &str) -> Result<OptimizeOutcome, String> {
    require_installed(base)?;
    if !is_elevated() {
        return elevate(base, "dnsSet", &[preset.to_string()]);
    }
    crate::network::apply_dns(base, preset)
        .map(|message| OptimizeOutcome { message, ..Default::default() })
}

/// 还原为切换公共 DNS 前的原始配置（写回原地址或恢复自动获取），并清除备份。
pub fn dns_restore(base: &Path) -> Result<OptimizeOutcome, String> {
    require_installed(base)?;
    if !is_elevated() {
        return elevate(base, "dnsRestore", &[]);
    }
    crate::network::restore_dns(base)
        .map(|message| OptimizeOutcome { message, ..Default::default() })
}

/* ── elevation helper ────────────────────────────────────────── */

#[cfg(windows)]
fn elevate(base: &Path, mode: &str, ids: &[String]) -> Result<OptimizeOutcome, String> {
    use std::time::{Duration, Instant};
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let request_path = base.join(REQUEST_FILE);
    let result_path = base.join(RESULT_FILE);
    let nonce = format!("{}-{}", now_millis(), std::process::id());
    let request = ElevatedRequest {
        nonce: nonce.clone(),
        base: base.to_string_lossy().to_string(),
        mode: mode.to_string(),
        ids: ids.to_vec(),
    };
    fs::write(
        &request_path,
        serde_json::to_vec(&request).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("无法写入提权请求：{error}"))?;
    let _ = fs::remove_file(&result_path);

    let exe = std::env::current_exe().map_err(|error| format!("无法定位主程序：{error}"))?;
    let params = format!("{CLI_FLAG} \"{}\"", request_path.to_string_lossy());
    let outcome = unsafe {
        ShellExecuteW(
            HWND::default(),
            &HSTRING::from("runas"),
            &HSTRING::from(exe.to_string_lossy().to_string()),
            &HSTRING::from(params),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if outcome.0 as isize <= 32 {
        return Ok(OptimizeOutcome {
            changed: Vec::new(),
            skipped: Vec::new(),
            message: "已取消管理员授权，未做任何改动".to_string(),
            elevated: false,
            cancelled: true,
        });
    }

    let deadline = Instant::now() + Duration::from_millis(ELEVATE_TIMEOUT_MS);
    while Instant::now() < deadline {
        if let Ok(text) = fs::read_to_string(&result_path) {
            if let Ok(result) = serde_json::from_str::<ElevatedResult>(&text) {
                if result.nonce == nonce {
                    let _ = fs::remove_file(&result_path);
                    let _ = fs::remove_file(&request_path);
                    if !result.ok {
                        return Err(result.message);
                    }
                    return Ok(OptimizeOutcome {
                        changed: result.changed,
                        skipped: result.skipped,
                        message: result.message,
                        elevated: true,
                        cancelled: false,
                    });
                }
            }
        }
        std::thread::sleep(Duration::from_millis(120));
    }

    Ok(OptimizeOutcome {
        changed: Vec::new(),
        skipped: Vec::new(),
        message: "仍在等待管理员授权；如果稍后确认，刷新本页即可看到结果".to_string(),
        elevated: false,
        cancelled: true,
    })
}

#[cfg(not(windows))]
fn elevate(_base: &Path, _mode: &str, _ids: &[String]) -> Result<OptimizeOutcome, String> {
    Err("一键优化目前只支持 Windows".to_string())
}

/* ── elevated CLI ────────────────────────────────────────────── */

fn handle_request(path: &Path) -> ElevatedResult {
    let text = fs::read_to_string(path).unwrap_or_default();
    let request = match serde_json::from_str::<ElevatedRequest>(&text) {
        Ok(request) => request,
        Err(error) => {
            return ElevatedResult {
                ok: false,
                message: format!("无法读取优化请求：{error}"),
                ..Default::default()
            }
        }
    };
    let base = PathBuf::from(&request.base);
    let outcome = match request.mode.as_str() {
        "apply" => apply_local(&base, &request.ids),
        "restore" => restore_local(&base, &request.ids, false),
        "restoreAll" => restore_local(&base, &[], true),
        "dnsSet" => match request.ids.first() {
            Some(preset) => crate::network::apply_dns(&base, preset)
                .map(|message| OptimizeOutcome { message, ..Default::default() }),
            None => Err("缺少 DNS 预设".to_string()),
        },
        "dnsRestore" => crate::network::restore_dns(&base)
            .map(|message| OptimizeOutcome { message, ..Default::default() }),
        _ => Err("未知的优化操作".to_string()),
    };
    match outcome {
        Ok(result) => ElevatedResult {
            nonce: request.nonce,
            ok: true,
            changed: result.changed,
            skipped: result.skipped,
            message: result.message,
        },
        Err(error) => ElevatedResult {
            nonce: request.nonce,
            ok: false,
            message: error,
            ..Default::default()
        },
    }
}

/// 提权子进程入口：命中命令行标记时执行请求并退出，不启动窗口。
pub fn run_cli() -> Option<i32> {
    let mut args = std::env::args_os();
    let mut request: Option<PathBuf> = None;
    while let Some(arg) = args.next() {
        if arg == CLI_FLAG {
            request = args.next().map(PathBuf::from);
            break;
        }
    }
    let Some(request_path) = request else {
        return None;
    };
    let result = handle_request(&request_path);
    if let Ok(data) = serde_json::to_vec(&result) {
        let base = fs::read_to_string(&request_path)
            .ok()
            .and_then(|text| serde_json::from_str::<ElevatedRequest>(&text).ok())
            .map(|request| PathBuf::from(request.base));
        if let Some(base) = base {
            let _ = fs::write(base.join(RESULT_FILE), data);
        }
    }
    Some(if result.ok { 0 } else { 1 })
}
