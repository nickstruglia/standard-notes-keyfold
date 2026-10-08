import { Component, type FunctionComponent, h } from 'preact'

const shallowEqual = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => Object.is(a[k], b[k]))
}

/** Skips re-rendering when props are shallowly equal (like React.memo). */
export const memo = <P extends object>(render: FunctionComponent<P>) =>
  class Memo extends Component<P> {
    shouldComponentUpdate(next: P) {
      return !shallowEqual(this.props as Record<string, unknown>, next as Record<string, unknown>)
    }
    render(props: P) {
      return h(render, props)
    }
  }
