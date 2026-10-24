// Over-the-shoulder third-person camera that blends to the eye for the scope and
// binoculars. A collision ray (spring arm) pulls it in when walls or terrain block it.
import * as THREE from 'three';

const OFFSETS = {         // [right, up, back] from the pivot, metres
  stand: [0.7, 0.25, 3.1],
  crouch: [0.7, 0.28, 2.7],
  prone: [0.55, 0.55, 3.0],
  pistolAim: [0.45, 0.12, 1.15],
};
const PIVOT_H = { stand: 1.55, crouch: 0.9, prone: 0.45 };

export class CameraRig {
  constructor(world) {
    this.world = world;
    this.pivot = new THREE.Vector3();
    this.pivotH = PIVOT_H.stand;
    this.off = [...OFFSETS.stand];
    this.armLen = OFFSETS.stand[2];
    this.firstPerson = 0;  // 0 = shoulder cam, 1 = eye
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._eye = new THREE.Vector3();
    this.v = { right: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3() };
  }

  // Places `camera`. view: { yaw, pitch, roll, alpha, pistolAim, fpBlend }
  update(dt, camera, player, view) {
    const target = view.pistolAim ? OFFSETS.pistolAim : OFFSETS[player.stance];
    for (let i = 0; i < 3; i++) this.off[i] += (target[i] - this.off[i]) * (1 - Math.exp(-10 * dt));
    this.pivotH += (PIVOT_H[player.stance] - this.pivotH) * (1 - Math.exp(-8 * dt));

    // Pivot follows the interpolated body position (frame-rate independent).
    const body = this._eye.lerpVectors(player.prevPos, player.pos, view.alpha);
    this.pivot.set(body.x, body.y + this.pivotH, body.z);

    this._e.set(view.pitch, view.yaw, view.roll);
    this._q.setFromEuler(this._e);
    const { right, up, fwd } = this.v;
    right.set(1, 0, 0).applyQuaternion(this._q);
    up.set(0, 1, 0).applyQuaternion(this._q);
    fwd.set(0, 0, -1).applyQuaternion(this._q);

    // Spring arm: shoulder point, then back along the view; shorten on collision.
    const shoulder = this.pivot.clone().addScaledVector(right, this.off[0]).addScaledVector(up, this.off[1]);
    const desiredLen = this.off[2];
    const end = shoulder.clone().addScaledVector(fwd, -desiredLen - 0.3);
    const hit = this.world.raycastSegment(shoulder, end);
    const allowed = hit ? Math.max(0.3, hit.distance - 0.3) : desiredLen;
    // Snap in instantly (never show the inside of a wall), ease back out.
    this.armLen = allowed < this.armLen ? allowed : this.armLen + (allowed - this.armLen) * (1 - Math.exp(-5 * dt));
    const third = shoulder.addScaledVector(fwd, -this.armLen);
    // Keep the lens above the ground.
    const g = this.world.floorAt(third.x, third.z, player.pos.y + 0.3) + 0.25;
    if (third.y < g) third.y = g;

    const eye = player.eyePosition(view.alpha, this._eye);
    const t = view.fpBlend * view.fpBlend * (3 - 2 * view.fpBlend);
    camera.position.lerpVectors(third, eye, t);
    camera.quaternion.copy(this._q);
    this.firstPerson = view.fpBlend;
  }
}
