/**
 * WelcomeScreen — 欢迎屏（等价旧版 showWelcome，22 条随机格言）
 */
import { useState } from 'react';

const MOTTOS = [
  '风起于青萍之末',
  '寂静深处，听见回声',
  '未经审视的生活不值得过',
  '山高月小，水落石出',
  '你所浪费的今天，是昨天殒去之人奢望的明天',
  '夜空中最亮的星，未必离你最近',
  '落花无言，人淡如菊',
  '海面之下，冰川犹在',
  '若机器有梦，它会梦见什么',
  '在无尽参数的尽头，是否也有一片星空',
  '每一次推理，都是一场微小的宇宙诞生',
  '把灯塔建在风暴里，把答案埋在路上',
  '你站在桥上看风景，桥下的人在看你',
  '尚未落下的太阳，照不亮已成定局的昨天',
  '语言是思想的牢笼，也是自由的翅膀',
  '时间不说话，却回答了所有问题',
  '每一次遗忘，都是一场温柔的清理',
  '走到这里，世界才刚刚开始',
  '风中的事，写在一块不会化的石头上',
  '别人看不见的你，都住在我心里',
  '这局没有对手，只有陪你落子的人',
  '雨要落了，我先把屋檐撑开',
];

export default function WelcomeScreen() {
  const [motto] = useState(() => MOTTOS[Math.floor(Math.random() * MOTTOS.length)]);
  return (
    <div className="welcome-screen">
      <div className="welcome-logo">Tiffa</div>
      <div className="welcome-title">与万物对弈，伴时间同行</div>
      <div className="welcome-motto">{motto}</div>
      <div className="welcome-hint">输入消息开始对话</div>
    </div>
  );
}
