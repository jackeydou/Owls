import owlsHomeMark from '../../../../../resources/owls-home-mark.png?asset'

export function EmptyChatLogo(): React.JSX.Element {
  return (
    <img
      alt=""
      className="mx-auto mb-4 block aspect-square w-24 select-none object-contain sm:w-28"
      draggable={false}
      src={owlsHomeMark}
    />
  )
}
